import { Op } from 'sequelize';
import { sequelize, Match, MatchMove, MatchMessage, User } from '../../models/index.js';
import { ApiError } from '../../utils/ApiError.js';
import { loadGame, tryMove, describeGameEnd } from '../../chess/chessValidation.js';
import * as walletService from '../wallet/wallet.service.js';
import { emitToUser } from '../../sockets/ioRegistry.js';
import { isOnline } from '../../sockets/presence.js';
import { startMoveTimer, clearMoveTimer, setForfeitHandler } from '../../sockets/moveTimeoutTracker.js';

/** Every match this user currently has 'active' — used by connectionHandler.js (checking
 *  reconnects/disconnects against) and by challenge.service.js (refusing to create/accept
 *  a challenge while already mid-match, since the frontend only ever tracks one
 *  activeMatch at a time — a second one wouldn't be invisible, just stuck, with no way to
 *  reach it or its escrowed stake short of a raw API call). */
export async function findActiveMatchesForUser(userId) {
  return Match.findAll({
    where: {
      status: 'active',
      [Op.or]: [{ whitePlayerId: userId }, { blackPlayerId: userId }]
    }
  });
}

export async function hasActiveMatch(userId) {
  const matches = await findActiveMatchesForUser(userId);
  return matches.length > 0;
}

/** The one place match money actually moves. Called for every ending: checkmate/draw
 *  (detected server-side in submitMove below), resignation, or a connection-timeout
 *  forfeit (see sockets/handlers/matchHandler.js). Idempotent — settling an
 *  already-completed match is a safe no-op, same guarantee the frontend's own
 *  settleMatch() makes, since more than one code path can race to call this for the
 *  same match (e.g. a move that delivers checkmate right as the loser also disconnects). */
async function settleMatch(matchId, { endReason, winnerId }) {
  const result = await sequelize.transaction(async t => {
    const match = await Match.findByPk(matchId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!match || match.status === 'completed') return null;

    const stake = Number(match.stake);
    const isDraw = !winnerId;
    match.status = 'completed';
    match.endedAt = new Date();
    match.endReason = endReason;
    match.turnDeadline = null; // no clock running on a finished match, regardless of how it ended
    match.pausedRemainingMs = null;

    if (isDraw) {
      match.outcome = 'draw';
      match.winnerId = null;
      await walletService.releaseEscrowAndPay(match.whitePlayerId, stake, stake, 'draw', match.id, t);
      await walletService.releaseEscrowAndPay(match.blackPlayerId, stake, stake, 'draw', match.id, t);
    } else {
      const loserId = winnerId === match.whitePlayerId ? match.blackPlayerId : match.whitePlayerId;
      match.outcome = winnerId === match.whitePlayerId ? 'white_win' : 'black_win';
      match.winnerId = winnerId;
      await walletService.releaseEscrowAndPay(winnerId, stake, stake * 2, 'win', match.id, t);
      await walletService.releaseEscrowAndPay(loserId, stake, 0, 'loss', match.id, t);
    }
    await match.save({ transaction: t });
    return match;
  });

  if (result) {
    // The match itself is done regardless of how it got here — checkmate, a resignation, a
    // connection-loss forfeit, or this very timer firing — so whatever move clock was
    // running for it is stale either way. One call here covers every settlement path rather
    // than needing a clearMoveTimer() at each individual call site above.
    clearMoveTimer(result.id);
    await notifyMatchEnded(result);
  }
  return result;
}

async function notifyMatchEnded(match) {
  const isDraw = !match.winnerId;
  const stake = Number(match.stake);
  const reasonText = {
    checkmate: 'Checkmate',
    draw: 'Draw',
    resignation: 'Resignation',
    timeout_forfeit: 'Connection timeout',
    disconnect_forfeit: 'Disconnected',
    move_timeout_forfeit: 'Move timeout',
    mutual_disconnect_void: 'Both players disconnected — stakes refunded'
  }[match.endReason] || 'Match ended';

  for (const playerId of [match.whitePlayerId, match.blackPlayerId]) {
    const { balance } = await walletService.getBalances(playerId);
    // outcome/payout are from THIS player's own perspective — win/lose/draw plus the net
    // change to their balance (not the gross credit — see wallet.service.js's payout
    // convention), so the frontend can build the same end-of-match modal for both players
    // from server data alone, rather than depending on each client's own chess.js having
    // independently reached the same conclusion (which is what used to leave the losing
    // side's modal dependent on a race between that local detection and this event).
    const outcome = isDraw ? 'draw' : match.winnerId === playerId ? 'win' : 'lose';
    const payout = isDraw ? 0 : outcome === 'win' ? stake : -stake;
    const outcomeText = isDraw ? `${reasonText} — Draw` : outcome === 'win' ? `${reasonText} — You Win` : `${reasonText} — You Lose`;
    emitToUser(playerId, 'match:ended', { matchId: match.id, outcomeText, outcome, payout, reasonText, balance });
  }
}

/** Matches frontend: matchApi.submitMove(matchId, san, fen) -> POST /matches/:id/moves
 *  (also mirrored over the socket as 'match:move' for lower latency — this REST call is
 *  the durable version that doesn't depend on the socket being connected). The `fen` the
 *  client sends is informational only; the move is replayed against the server's own
 *  stored FEN and validated fresh; a mismatch after applying it would mean the client's
 *  local state has already diverged, which is itself worth surfacing as an error rather
 *  than silently trusting the client's version. */
export async function submitMove(matchId, userId, { san, from, to, promotion }) {
  const match = await Match.findByPk(matchId);
  if (!match) throw new ApiError(404, 'Match not found.');
  if (match.status !== 'active') throw new ApiError(409, 'This match has already ended.');

  const isWhite = match.whitePlayerId === userId;
  const isBlack = match.blackPlayerId === userId;
  if (!isWhite && !isBlack) throw new ApiError(403, 'You are not a participant in this match.');

  const game = loadGame(match.fen);
  const turnColor = game.turn();
  const turnUserId = turnColor === 'w' ? match.whitePlayerId : match.blackPlayerId;

  // Belt-and-suspenders against a lost in-memory move timer (see moveTimeoutTracker.js's
  // own caveat about a server restart mid-turn dropping its scheduled setTimeout): if the
  // persisted deadline has already passed, settle the forfeit right now instead of quietly
  // accepting a move that arrived too late because nothing was left running to catch it.
  if (match.turnDeadline && new Date() > match.turnDeadline) {
    await forfeitByMoveTimeout(matchId, turnUserId);
    throw new ApiError(409, 'This match has already ended.');
  }

  if ((turnColor === 'w' && !isWhite) || (turnColor === 'b' && !isBlack)) {
    throw new ApiError(409, "It's not your turn.");
  }

  const move = tryMove(game, { san, from, to, promotion });
  if (!move) throw new ApiError(400, 'Illegal move.');

  const moveNumber = await MatchMove.count({ where: { matchId } });
  await MatchMove.create({
    matchId,
    playerId: userId,
    moveNumber: moveNumber + 1,
    color: turnColor,
    san: move.san,
    fenAfter: game.fen()
  });
  match.fen = game.fen();

  const opponentId = isWhite ? match.blackPlayerId : match.whitePlayerId;
  const endState = describeGameEnd(game);
  // Only restart the clock for the OTHER side if the game isn't already over — settleMatch
  // (called below when it is) clears it and nulls turnDeadline itself, and starting a fresh
  // one here first would just have that immediately clear it again.
  let turnDeadline = null;
  if (!endState.isOver) {
    turnDeadline = startMoveTimer(matchId, opponentId);
    match.turnDeadline = turnDeadline;
    match.pausedRemainingMs = null; // a real move landing supersedes any stale paused-clock bookkeeping
  }
  await match.save();

  // from/to/promotion, not just san — see applyOpponentMove on the frontend and tryMove
  // above for why the object form is what actually gets relayed and replayed now.
  // turnDeadline (null once the game's over) lets the receiving client sync its own
  // move-clock display to the server's real deadline instead of a locally-guessed one.
  emitToUser(opponentId, 'match:move', {
    matchId,
    from: move.from,
    to: move.to,
    promotion: move.promotion,
    san: move.san,
    turnDeadline
  });

  if (endState.isOver) {
    const winnerId =
      endState.reason === 'checkmate'
        ? endState.matedColor === 'w' ? match.blackPlayerId : match.whitePlayerId
        : null; // stalemate/insufficient-material/repetition/50-move are all draws
    await settleMatch(match.id, { endReason: endState.reason === 'checkmate' ? 'checkmate' : 'draw', winnerId });
  }

  return { san: move.san, fen: game.fen(), gameOver: endState.isOver, turnDeadline };
}

/** A resignation reported by either the loser resigning voluntarily, a client
 *  self-reporting a loss via POST /matches/:id/result (see match.controller.js — this is
 *  safe to trust precisely because a self-reported LOSS can't be used to steal funds the
 *  way a self-reported win could), or the 'match:resign' socket event. */
export async function resignMatch(matchId, resignerId) {
  const match = await Match.findByPk(matchId);
  if (!match) throw new ApiError(404, 'Match not found.');
  if (match.status !== 'active') return { alreadySettled: true };

  const isWhite = match.whitePlayerId === resignerId;
  const isBlack = match.blackPlayerId === resignerId;
  if (!isWhite && !isBlack) throw new ApiError(403, 'You are not a participant in this match.');

  const winnerId = isWhite ? match.blackPlayerId : match.whitePlayerId;
  const result = await settleMatch(matchId, { endReason: 'resignation', winnerId });
  return { alreadySettled: !result };
}

/** Called by matchHandler.js's disconnect-timeout logic once the 5-minute reconnection
 *  window actually expires — same settlement path, different endReason for the record. */
export async function forfeitByConnectionTimeout(matchId, disconnectedUserId) {
  const match = await Match.findByPk(matchId);
  if (!match || match.status !== 'active') return null;
  const winnerId = match.whitePlayerId === disconnectedUserId ? match.blackPlayerId : match.whitePlayerId;
  // If the side who'd otherwise win this by forfeit isn't around either, this wasn't one
  // player abandoning a patient opponent — it's both walking away, and awarding a "win" to
  // someone who isn't even there to claim it is an arbitrary outcome that just depends on
  // who happened to close their tab a few seconds later than the other. Void the match and
  // refund both stakes instead of picking a winner neither side is present for.
  if (!isOnline(winnerId)) {
    return settleMatch(matchId, { endReason: 'mutual_disconnect_void', winnerId: null });
  }
  return settleMatch(matchId, { endReason: 'timeout_forfeit', winnerId });
}

/** Called by moveTimeoutTracker.js once a player's 30-second move clock runs out without
 *  them submitting a move — the scenario this whole mechanism exists for: someone accepts a
 *  challenge (or is mid-match) and then just sits on the position with a perfectly live
 *  connection, which forfeitByConnectionTimeout above can't catch since they never actually
 *  disconnect. Also invoked directly from submitMove/getMatch when a stale persisted
 *  deadline is discovered (a lost in-memory timer, e.g. after a restart), so this always
 *  re-checks match.status itself rather than trusting the caller. Unlike the connection-loss
 *  version, there's no "is the winner even online" check — the opponent being present and
 *  waiting on a move that never comes is exactly the case this is for, not a mutual
 *  abandonment. */
export async function forfeitByMoveTimeout(matchId, timedOutUserId) {
  const match = await Match.findByPk(matchId);
  if (!match || match.status !== 'active') return null;
  const winnerId = match.whitePlayerId === timedOutUserId ? match.blackPlayerId : match.whitePlayerId;
  return settleMatch(matchId, { endReason: 'move_timeout_forfeit', winnerId });
}

/** Called from connectionHandler.js the instant EITHER participant of a match goes offline
 *  — not only when it's specifically their own turn. ChessBoard.jsx's `frozen` flag (driven
 *  by activeMatch.connectionLostSide) blocks clicking a move for BOTH players the moment
 *  either one disconnects, so leaving the 30-second move clock running underneath a frozen
 *  board would forfeit someone for not doing something the UI itself won't let them do
 *  right then. The 5-minute connection-loss forfeit (connectionTimeoutTracker.js) is what's
 *  actually meant to catch a real, sustained disconnect; this just gets the unrelated,
 *  much-shorter move clock out of its way rather than letting the two race each other.
 *  A no-op if there's no clock currently running (nothing to pause) or the match has
 *  already ended. */
export async function pauseMoveClock(matchId) {
  const match = await Match.findByPk(matchId);
  if (!match || match.status !== 'active' || !match.turnDeadline) return;
  clearMoveTimer(matchId);
  // Captured so resumeMoveClockIfBothOnline can hand back exactly this much time rather
  // than a fresh 30 seconds — see pausedRemainingMs's own comment on the model.
  match.pausedRemainingMs = Math.max(0, match.turnDeadline.getTime() - Date.now());
  match.turnDeadline = null;
  await match.save();
}

/** Called from connectionHandler.js whenever a participant reconnects — but only actually
 *  restarts the clock once BOTH sides are confirmed online, since that's the same condition
 *  the frontend uses to unfreeze the board (see ChessBoard.jsx again): one side reconnecting
 *  while the other is still gone leaves the board just as frozen as before, so restarting a
 *  clock nobody can act on yet would be exactly the bug this whole mechanism exists to avoid.
 *  Restarts from a full 30 seconds rather than reconstructing exactly how much time was left
 *  when the disconnect happened — simpler, and arguably fairer, than trying to account for
 *  an outage of unknown length. Pushes the new deadline to both players directly (rather
 *  than leaving each client to guess one locally, the way a normal move's clock reset does)
 *  since neither client can independently know the moment both sides are actually back —
 *  only the server, checking presence for both ids, can. */
export async function resumeMoveClockIfBothOnline(matchId) {
  const match = await Match.findByPk(matchId);
  if (!match || match.status !== 'active' || match.turnDeadline) return; // not paused, or already ended
  if (!isOnline(match.whitePlayerId) || !isOnline(match.blackPlayerId)) return;
  const game = loadGame(match.fen);
  const turnUserId = game.turn() === 'w' ? match.whitePlayerId : match.blackPlayerId;
  // Resume with whatever was actually left when this got paused, not a fresh 30 seconds —
  // pausedRemainingMs is only null the very first time a match's clock ever starts (there's
  // nothing to resume from yet), in which case the full per-move limit is the right amount.
  const remainingMs = match.pausedRemainingMs != null ? match.pausedRemainingMs : undefined;
  const turnDeadline = startMoveTimer(matchId, turnUserId, remainingMs);
  match.turnDeadline = turnDeadline;
  match.pausedRemainingMs = null;
  await match.save();
  emitToUser(match.whitePlayerId, 'match:clockResumed', { matchId, turnDeadline });
  emitToUser(match.blackPlayerId, 'match:clockResumed', { matchId, turnDeadline });
}

// Registered here (rather than moveTimeoutTracker.js importing this file directly) to keep
// the dependency one-way — see moveTimeoutTracker.js's own comment on why.
setForfeitHandler(forfeitByMoveTimeout);

/** POST /matches/:id/result — see resignMatch's doc comment on why only a self-reported
 *  loss or a draw are trusted; a self-reported win is rejected outright. */
export async function reportResult(matchId, reporterId, claimedResult) {
  const match = await Match.findByPk(matchId);
  if (!match) throw new ApiError(404, 'Match not found.');
  if (match.status === 'completed') return { alreadySettled: true };

  const isParticipant = match.whitePlayerId === reporterId || match.blackPlayerId === reporterId;
  if (!isParticipant) throw new ApiError(403, 'You are not a participant in this match.');

  if (claimedResult === 'win') {
    throw new ApiError(409, 'Match outcomes are determined by the server, not reported by a winner.');
  }
  if (claimedResult === 'draw') {
    const result = await settleMatch(matchId, { endReason: 'draw', winnerId: null });
    return { alreadySettled: !result };
  }
  // 'loss' (or anything else) — treat as a resignation from the reporter.
  return resignMatch(matchId, reporterId);
}

/** Matches frontend: matchApi.getMatch(id) -> GET /matches/:id. When the match has
 *  completed, this returns the same {outcome, payout, reasonText, balance} shape
 *  'match:ended' pushes over the socket, from the REQUESTER's own perspective — see
 *  useMatchEndPolling.js on the frontend, which polls this as a backstop for the rare
 *  case where that socket event never arrives (a drop, a brief disconnect at exactly the
 *  wrong moment) and applies the result through the exact same path either way. Returns
 *  just {status:'active'} while the match is still ongoing — nothing to resolve yet. */
export async function getMatch(matchId, requesterId) {
  const match = await Match.findByPk(matchId);
  if (!match) throw new ApiError(404, 'Match not found.');
  const isParticipant = match.whitePlayerId === requesterId || match.blackPlayerId === requesterId;
  if (!isParticipant) throw new ApiError(403, 'You are not a participant in this match.');

  // Same belt-and-suspenders as submitMove: a client polling this (see
  // useMatchEndPolling.js) should discover a move-timeout forfeit promptly even if the
  // in-memory timer that would normally catch it got lost to a server restart, rather than
  // waiting on nothing to resolve it.
  if (match.status === 'active' && match.turnDeadline && new Date() > match.turnDeadline) {
    const game = loadGame(match.fen);
    const turnUserId = game.turn() === 'w' ? match.whitePlayerId : match.blackPlayerId;
    await forfeitByMoveTimeout(matchId, turnUserId);
    return getMatch(matchId, requesterId); // re-fetch — now completed, returns the settled result below
  }

  if (match.status !== 'completed') {
    return { id: match.id, status: match.status };
  }

  const isDraw = !match.winnerId;
  const stake = Number(match.stake);
  const outcome = isDraw ? 'draw' : match.winnerId === requesterId ? 'win' : 'lose';
  const payout = isDraw ? 0 : outcome === 'win' ? stake : -stake;
  const reasonText = {
    checkmate: 'Checkmate',
    draw: 'Draw',
    resignation: 'Resignation',
    timeout_forfeit: 'Connection timeout',
    disconnect_forfeit: 'Disconnected',
    move_timeout_forfeit: 'Move timeout',
    mutual_disconnect_void: 'Both players disconnected — stakes refunded'
  }[match.endReason] || 'Match ended';
  const { balance } = await walletService.getBalances(requesterId);

  return { id: match.id, status: 'completed', outcome, payout, reasonText, balance };
}

/** Lets a page reload restore a match in progress instead of just losing track of it — a
 *  refresh tears down all of this app's state (see useMatchStore.js's restoreSession),
 *  activeMatch included, even though the match itself is still very much alive here, with
 *  a real stake still in escrow. Returns null rather than 404ing when there's nothing to
 *  resume, since "no active match" is the normal case for most people most of the time,
 *  not an error. turnDeadline is included so the resumed client can render an accurate
 *  remaining countdown instead of blindly restarting a fresh 30 seconds. */
export async function getActiveMatchForUser(userId) {
  const matches = await findActiveMatchesForUser(userId);
  if (matches.length === 0) return null;
  // If this user is somehow in more than one (shouldn't happen going forward — see
  // hasActiveMatch's use in challenge.service.js — but could still exist from before that
  // guard existed), resume whichever started most recently rather than picking arbitrarily.
  const match = matches.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
  const isWhite = match.whitePlayerId === userId;
  const opponentId = isWhite ? match.blackPlayerId : match.whitePlayerId;
  const opponent = await User.findByPk(opponentId);
  return {
    id: match.id,
    opponentName: opponent?.name ?? 'Unknown',
    stake: Number(match.stake),
    fen: match.fen,
    color: isWhite ? 'w' : 'b',
    turnDeadline: match.turnDeadline
  };
}

const MAX_CHAT_MESSAGE_LENGTH = 500;

/** Shared by the socket 'match:chat' handler and the REST fallback — validates the sender
 *  is actually a participant (not just anyone who knows the match id), persists the
 *  message, and returns it shaped for the frontend. Doesn't check match.status: chat stays
 *  open after a match ends too (a "gg" is normal), same as there's no cleanup job removing
 *  a completed match's messages. */
export async function sendMatchMessage(matchId, senderId, text) {
  const trimmed = (text || '').trim();
  if (!trimmed) throw new ApiError(400, 'Message cannot be empty.');
  if (trimmed.length > MAX_CHAT_MESSAGE_LENGTH) {
    throw new ApiError(400, `Messages can't be longer than ${MAX_CHAT_MESSAGE_LENGTH} characters.`);
  }

  const match = await Match.findByPk(matchId);
  if (!match) throw new ApiError(404, 'Match not found.');
  const isParticipant = match.whitePlayerId === senderId || match.blackPlayerId === senderId;
  if (!isParticipant) throw new ApiError(403, 'You are not a participant in this match.');

  const sender = await User.findByPk(senderId);
  const message = await MatchMessage.create({ matchId, senderId, text: trimmed });
  const shaped = { id: message.id, matchId, senderId, senderName: sender.name, text: trimmed, createdAt: message.createdAt };

  // Relayed to BOTH participants, sender included — same reasoning as move relay: the
  // server's copy is authoritative, so the sender's own UI adds the message from this
  // event rather than trusting its own optimistic guess, keeping multiple tabs/devices for
  // the same account consistent too.
  const opponentId = match.whitePlayerId === senderId ? match.blackPlayerId : match.whitePlayerId;
  emitToUser(senderId, 'match:chat', shaped);
  emitToUser(opponentId, 'match:chat', shaped);

  return shaped;
}

/** Full chat history for one match, oldest first — loaded once when a match view opens or
 *  resumes (see useMatchStore.js), then kept current from there via the live 'match:chat'
 *  event above rather than re-polled. */
export async function getMatchMessages(matchId, requesterId) {
  const match = await Match.findByPk(matchId);
  if (!match) throw new ApiError(404, 'Match not found.');
  const isParticipant = match.whitePlayerId === requesterId || match.blackPlayerId === requesterId;
  if (!isParticipant) throw new ApiError(403, 'You are not a participant in this match.');

  const messages = await MatchMessage.findAll({
    where: { matchId },
    include: [{ model: User, as: 'sender', attributes: ['id', 'name'] }],
    order: [['createdAt', 'ASC']],
    limit: 200
  });
  return messages.map(m => ({
    id: m.id,
    matchId,
    senderId: m.senderId,
    senderName: m.sender?.name ?? 'Unknown',
    text: m.text,
    createdAt: m.createdAt
  }));
}

export { settleMatch };

/** Every completed match this user has played, newest first — the persistent record behind
 *  the frontend's Match History list (see useMatchStore.js's loadMatchHistory). That list
 *  used to be built purely from local, in-memory accumulation as matches finished during
 *  the current session, so it reset to empty on every refresh; this is what makes it
 *  actually persistent, the same way match history says it should be. payout mirrors
 *  exactly what the frontend already computes locally for the same outcome (see
 *  applyLocalOutcome) — net winnings/loss relative to the stake, not the raw wallet credit
 *  — so old and freshly-arrived entries render identically. */
export async function getMatchHistoryForUser(userId) {
  const matches = await Match.findAll({
    where: {
      status: 'completed',
      [Op.or]: [{ whitePlayerId: userId }, { blackPlayerId: userId }]
    },
    include: [
      { model: User, as: 'whitePlayer', attributes: ['id', 'name'] },
      { model: User, as: 'blackPlayer', attributes: ['id', 'name'] }
    ],
    order: [['endedAt', 'DESC']],
    limit: 100
  });

  return matches.map(m => {
    const isWhite = m.whitePlayerId === userId;
    const opponent = isWhite ? m.blackPlayer : m.whitePlayer;
    const stake = Number(m.stake);
    let outcome, payout;
    if (!m.winnerId) {
      outcome = 'draw';
      payout = 0; // stake simply returned — see settleMatch
    } else if (m.winnerId === userId) {
      outcome = 'win';
      payout = stake; // net winnings: your own stake back plus the opponent's matching stake
    } else {
      outcome = 'lose';
      payout = -stake;
    }
    return {
      matchId: m.id,
      opponentName: opponent?.name ?? 'Unknown',
      stake,
      outcome,
      payout,
      date: m.endedAt
    };
  });
}
