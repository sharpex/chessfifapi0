import { sequelize, User, Challenge, Match } from '../../models/index.js';
import { ApiError } from '../../utils/ApiError.js';
import * as walletService from '../wallet/wallet.service.js';
import { emitToUser, broadcastToAll } from '../../sockets/ioRegistry.js';
import { sendPushToUser, sendPushToAllExcept } from '../../utils/webPush.js';
import { INITIAL_FEN } from '../../chess/constants.js';
import { hasActiveMatch, resumeMoveClockIfBothOnline } from '../matches/match.service.js';
import { isOnline } from '../../sockets/presence.js';

/** A member may have at most one *open* challenge (opponentId null) live at a time —
 *  this is what the frontend's editable/deletable "your open challenge" card assumes.
 *  Direct challenges (targeting a specific opponent by id) aren't subject to this —
 *  they resolve quickly (accept/decline/timeout) rather than sitting around to manage. */
async function assertNoExistingOpenChallenge(creatorId) {
  const existing = await Challenge.findOne({ where: { creatorId, status: 'open', opponentId: null } });
  if (existing) {
    throw new ApiError(409, 'You already have an active challenge. Edit or delete it before creating another.');
  }
}

/** opponentId is null for an open challenge; otherwise it's the target player's actual
 *  User id, taken from the lobby list's own data (see lobby.service.js's getOnlinePlayers)
 *  rather than a typed/displayed name — names aren't unique in this schema (only email is),
 *  so matching on name risked challenging (or 404ing against) the wrong same-named player. */
export async function createChallenge(creatorId, opponentId, stake) {
  if (!(stake >= 100)) throw new ApiError(400, 'Stake must be at least KSh 100.');
  if (await hasActiveMatch(creatorId)) {
    throw new ApiError(409, 'Finish your current match before creating a new challenge.');
  }

  if (opponentId) {
    if (opponentId === creatorId) throw new ApiError(400, "You can't challenge yourself.");
    const opponent = await User.findByPk(opponentId);
    if (!opponent) throw new ApiError(404, 'That player is no longer available.');
  } else {
    await assertNoExistingOpenChallenge(creatorId);
  }

  const { balance } = await walletService.getBalances(creatorId);
  if (balance < stake) throw new ApiError(400, "You don't have enough balance for that stake.");

  const challenge = await Challenge.create({ creatorId, opponentId, stake, status: 'open' });

  if (opponentId) {
    const creator = await User.findByPk(creatorId);
    emitToUser(opponentId, 'challenge:incoming', { id: challenge.id, fromName: creator.name, stake: Number(stake) });
    sendPushToUser(opponentId, {
      title: 'New challenge!',
      body: `${creator.name} challenged you for KSh ${Number(stake).toFixed(2)}.`,
      data: { type: 'challenge:incoming', challengeId: challenge.id }
    });
  } else {
    // Open to anyone — announce it lobby-wide (guests included, see socketAuth.js) rather
    // than to one specific person, so it shows up live in everyone's "available
    // challenges" list instead of only surfacing on their next poll/refresh.
    const creator = await User.findByPk(creatorId);
    broadcastToAll('challenge:posted', {
      id: challenge.id,
      creatorName: creator.name,
      stake: Number(stake),
      createdAt: challenge.createdAt
    });
    // Push too, not just the socket event — the socket broadcast only reaches a tab
    // that's actually open right now; push reaches everyone who's enabled it even with
    // the app closed, which matters more here than for a targeted challenge since this
    // is meant for whoever happens to be free to accept it, not one specific person
    // already expecting it. Excludes the creator themselves, obviously.
    sendPushToAllExcept(creatorId, {
      title: 'New open challenge!',
      body: `${creator.name} posted an open challenge for KSh ${Number(stake).toFixed(2)} — first to accept plays them.`,
      data: { type: 'challenge:posted', challengeId: challenge.id }
    });
  }

  return { id: challenge.id };
}

/** Every challenge this member has created, any status, newest first — the "My
 *  Challenges" history view. Distinct from getOpenChallenges (that's what anyone else can
 *  accept; this is one person's own full record, including ones already resolved). Only
 *  'open' ones are actually editable/deletable — see updateChallengeStake/cancelChallenge,
 *  which already enforce that server-side regardless of what the UI does or doesn't grey
 *  out, so `status` is included here specifically so the frontend can reflect that truth
 *  rather than showing edit/delete controls that would just fail. */
export async function getMyChallenges(creatorId) {
  const challenges = await Challenge.findAll({
    where: { creatorId },
    include: [{ model: User, as: 'opponent' }],
    order: [['createdAt', 'DESC']],
    limit: 50
  });
  return challenges.map(c => ({
    id: c.id,
    stake: Number(c.stake),
    status: c.status, // 'open' | 'accepted' | 'declined' | 'cancelled'
    opponentName: c.opponent?.name ?? null, // null: open-to-anyone, or not yet resolved
    createdAt: c.createdAt
  }));
}

/** Matches frontend polling (challengeApi.getStatus) — used as a fallback when the
 *  socket push (challenge:accepted / challenge:declined) hasn't arrived yet, e.g. right
 *  after a page reload with no live connection established. */
export async function getChallengeStatus(challengeId) {  const challenge = await Challenge.findByPk(challengeId, { include: [{ model: User, as: 'opponent' }] });
  if (!challenge) throw new ApiError(404, 'Challenge not found.');
  let matchId = null;
  let turnDeadline = null;
  if (challenge.status === 'accepted') {
    // The poll's whole reason to exist is catching an acceptance the socket push missed —
    // so the caller needs the real Match id here too, not just the challenge's own id
    // (they're different rows/tables; using the challenge id to submit moves against is
    // exactly the bug this lookup exists to avoid). turnDeadline rides along too, so a
    // poller starting a match this way gets the same accurate clock a socket push would've
    // carried, rather than a client-guessed one.
    const match = await Match.findOne({ where: { challengeId: challenge.id } });
    matchId = match ? match.id : null;
    turnDeadline = match ? match.turnDeadline : null;
  }
  return {
    status: challenge.status,
    opponentName: challenge.opponent?.name ?? null,
    stake: Number(challenge.stake),
    matchId,
    turnDeadline
  };
}

/** The heart of the wagering flow: both stakes move into escrow and a Match is created,
 *  all inside one DB transaction so a failure partway through (e.g. one player's balance
 *  changed between challenge creation and acceptance) leaves neither side charged. */
export async function acceptChallenge(challengeId, accepterId) {
  // Both checked before the transaction below — neither is the actual money-safety
  // guarantee (that's the row lock + escrow hold inside it), just a pre-flight check
  // against the specific "you're already elsewhere" scenarios this whole function exists
  // to prevent: the frontend only ever tracks one active match at a time, so anyone
  // ending up in a second one has no way to reach it, or the stake locked up in it, short
  // of a raw API call. There's a narrow race if two accepts targeting the same person land
  // at nearly the same instant — acceptable here since the worst case is the pre-existing
  // problem this mostly closes off, not a money-safety issue (the escrow hold itself is
  // still correctly serialized by the transaction's row lock regardless).
  if (await hasActiveMatch(accepterId)) {
    throw new ApiError(409, 'Finish your current match before accepting another challenge.');
  }

  const result = await sequelize.transaction(async t => {
    const challenge = await Challenge.findByPk(challengeId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!challenge) throw new ApiError(404, 'Challenge not found.');
    if (challenge.status !== 'open') throw new ApiError(409, 'This challenge is no longer available.');
    if (challenge.creatorId === accepterId) throw new ApiError(400, "You can't accept your own challenge.");
    if (challenge.opponentId && challenge.opponentId !== accepterId) {
      throw new ApiError(403, 'This challenge was sent to someone else.');
    }
    if (await hasActiveMatch(challenge.creatorId)) {
      // The creator has ended up in a different match since posting this — most likely
      // they accepted someone else's challenge while this one was still sitting open.
      // Surface that plainly rather than letting the accept succeed and leaving the
      // creator in two matches the frontend has no way to show them both.
      throw new ApiError(409, "This challenge's creator is already in another match.");
    }

    // Last gate before anything actually commits (the match row and both escrow holds
    // just below) — deliberately last, after the accepter has already cleared both the
    // auth gate and the wallet-funding gate on the frontend (see
    // useMatchStore.js's handleAcceptIncomingClick -> acceptIncomingChallenge, which only
    // ever calls this once both have passed). That ordering means this only ever fires
    // for someone genuinely committed to playing right now, not a casual click from
    // someone who was never going to sign in or fund their wallet anyway — worth being
    // deliberate about, since it's also what decides whether the creator gets a
    // "you missed a challenge" push below.
    //
    // Rather than start a match with a paused clock and leave the accepter locked into
    // waiting for a creator who isn't even there (hasActiveMatch above would then block
    // them from doing anything else in the meantime), refuse the accept outright and let
    // the creator know they missed it.
    if (!isOnline(challenge.creatorId)) {
      const creator = await User.findByPk(challenge.creatorId, { transaction: t });
      const accepter = await User.findByPk(accepterId, { transaction: t });
      sendPushToUser(challenge.creatorId, {
        title: 'You missed a challenge!',
        body: `${accepter?.name ?? 'A player'} wanted to accept your KSh ${Number(challenge.stake).toFixed(2)} challenge, but you were offline. Come back online to catch them.`,
        data: { type: 'challenge:missedAccept', challengeId: challenge.id }
      });
      throw new ApiError(409, `${creator?.name ?? 'That player'} is offline right now — you can't accept this challenge until they're back online. Why not create your own challenge and share it on social media to find someone else to play in the meantime?`);
    }

    const stake = Number(challenge.stake);
    const wasOpenToAnyone = challenge.opponentId === null; // capture before this mutates it below
    // Creator plays White, accepter plays Black — matches the frontend's beginMatch()
    // convention (the challenger's own client always starts them as 'w').
    const match = await Match.create(
      {
        challengeId: challenge.id,
        whitePlayerId: challenge.creatorId,
        blackPlayerId: accepterId,
        stake,
        fen: INITIAL_FEN
      },
      { transaction: t }
    );

    await walletService.holdEscrow(challenge.creatorId, stake, { matchId: match.id, challengeId: challenge.id }, t);
    await walletService.holdEscrow(accepterId, stake, { matchId: match.id, challengeId: challenge.id }, t);

    challenge.status = 'accepted';
    challenge.opponentId = accepterId;
    challenge.matchId = match.id;
    await challenge.save({ transaction: t });

    return { challenge, match, wasOpenToAnyone };
  });

  if (result.wasOpenToAnyone) {
    // No longer available — tell everyone browsing the open-challenges list to drop it,
    // not just the two people now actually in the match.
    broadcastToAll('challenge:removed', { id: challengeId });
  }

  // Creator plays White and moves first, so their clock is what starts running — but only
  // if they're actually online to see it. An open challenge can sit around for a while
  // before someone accepts it, so the creator being offline right now (they'll get the
  // push notification below, but might not see it inside 30 seconds) is a real case, not
  // just theoretical — reusing the same presence-checked helper the reconnect flow uses
  // means this naturally does nothing if they're not there, and the clock starts itself
  // the moment connectionHandler.js sees them come back online (see its reconnect
  // handling), same as any other paused-clock resume. Outside the transaction above since
  // this only touches the in-memory tracker/an in-memory presence check, nothing that
  // needs to roll back together with the DB writes.
  await resumeMoveClockIfBothOnline(result.match.id);
  const startedMatch = await Match.findByPk(result.match.id);
  const turnDeadline = startedMatch.turnDeadline;

  const accepter = await User.findByPk(accepterId);
  const creator = await User.findByPk(result.challenge.creatorId);
  emitToUser(result.challenge.creatorId, 'challenge:accepted', {
    challengeId,
    opponentName: accepter.name,
    matchId: result.match.id,
    turnDeadline
  });
  // Push notification too, not just the socket event — the socket only reaches a tab
  // that's actually open right now, which is precisely the case (challenger stepped away,
  // closed the tab) push notifications exist to cover. Best-effort and silent on failure;
  // see sendPushToUser for why this can never throw into the accept flow itself.
  sendPushToUser(result.challenge.creatorId, {
    title: 'Challenge accepted!',
    body: `${accepter.name} accepted your KSh ${Number(result.match.stake).toFixed(2)} challenge — the match has started.`,
    data: { type: 'challenge:accepted', challengeId, matchId: result.match.id }
  });

  // This return value is the HTTP response to the ACCEPTER's own request — their opponent
  // is the challenge's creator, not themselves. Reusing `accepter.name` here (as an earlier
  // version of this did) told the accepter their own name was their opponent's, which is
  // exactly the "playing myself" bug this was fixed for.
  return { matchId: result.match.id, opponentName: creator.name, stake: Number(result.match.stake), turnDeadline };
}

export async function declineChallenge(challengeId, declinerId) {
  const challenge = await Challenge.findByPk(challengeId);
  if (!challenge) throw new ApiError(404, 'Challenge not found.');
  if (challenge.status !== 'open') return { ok: true }; // already resolved — nothing to do
  if (challenge.opponentId && challenge.opponentId !== declinerId) {
    throw new ApiError(403, 'This challenge was sent to someone else.');
  }

  challenge.status = 'declined';
  await challenge.save();

  const decliner = await User.findByPk(declinerId);
  emitToUser(challenge.creatorId, 'challenge:declined', { challengeId, opponentName: decliner.name });
  return { ok: true };
}

export async function updateChallengeStake(challengeId, creatorId, newStake) {
  if (!(newStake >= 100)) throw new ApiError(400, 'Stake must be at least KSh 100.');
  const challenge = await Challenge.findByPk(challengeId);
  if (!challenge) throw new ApiError(404, 'Challenge not found.');
  if (challenge.creatorId !== creatorId) throw new ApiError(403, 'Only the creator can edit this challenge.');
  if (challenge.status !== 'open') throw new ApiError(409, 'This challenge can no longer be edited.');

  const { balance } = await walletService.getBalances(creatorId);
  if (balance < newStake) throw new ApiError(400, "You don't have enough balance for that stake.");

  challenge.stake = newStake;
  await challenge.save();
  if (!challenge.opponentId) {
    broadcastToAll('challenge:updated', { id: challenge.id, stake: Number(challenge.stake) });
  }
  return { id: challenge.id, stake: Number(challenge.stake) };
}

export async function cancelChallenge(challengeId, creatorId) {
  const challenge = await Challenge.findByPk(challengeId);
  if (!challenge) throw new ApiError(404, 'Challenge not found.');
  if (challenge.creatorId !== creatorId) throw new ApiError(403, 'Only the creator can delete this challenge.');
  if (challenge.status !== 'open') throw new ApiError(409, 'This challenge can no longer be deleted.');

  challenge.status = 'cancelled';
  await challenge.save();
  if (!challenge.opponentId) {
    broadcastToAll('challenge:removed', { id: challenge.id });
  }
  return { ok: true };
}
