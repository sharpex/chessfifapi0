import { markOnline, markOffline } from '../presence.js';
import { startForfeitTimer, cancelForfeitTimer } from '../connectionTimeoutTracker.js';
import { registerMatchHandlers } from './matchHandler.js';
import { findActiveMatchesForUser, pauseMoveClock, resumeMoveClockIfBothOnline } from '../../modules/matches/match.service.js';
import { broadcastToAll } from '../ioRegistry.js';

export function registerConnectionHandlers(io, socket) {
  const userId = socket.userId;

  registerMatchHandlers(socket);

  if (!userId) return; // guest — connected for public broadcasts only, nothing per-user to set up

  const justCameOnline = markOnline(userId, socket.id);
  socket.join(`user:${userId}`);

  // Someone's overall online status just flipped (this isn't just a second tab opening —
  // see markOnline's own comment) — let everyone else's lobby view pick that up live
  // instead of only on their next manual refresh. No payload needed; the frontend just
  // re-fetches the players list on this signal (see useSocketBridge.js's
  // onLobbyPresenceChanged) rather than trying to patch one row in place, since presence
  // for OTHER people already online isn't known here.
  if (justCameOnline) broadcastToAll('lobby:presenceChanged', {});

  // Reconnecting mid-match cancels any forfeit countdown that was running against them, and
  // — if their opponent is also online (resumeMoveClockIfBothOnline no-ops otherwise) —
  // resumes the move clock that was paused the moment either side went offline.
  findActiveMatchesForUser(userId).then(matches => {
    for (const match of matches) {
      const opponentId = match.whitePlayerId === userId ? match.blackPlayerId : match.whitePlayerId;
      cancelForfeitTimer(match.id, userId, opponentId);
      resumeMoveClockIfBothOnline(match.id);
    }
  });

  socket.on('disconnect', async () => {
    const wentFullyOffline = markOffline(userId, socket.id);
    if (!wentFullyOffline) return; // they still have another open tab/device — not actually gone

    broadcastToAll('lobby:presenceChanged', {});

    const matches = await findActiveMatchesForUser(userId);
    for (const match of matches) {
      const opponentId = match.whitePlayerId === userId ? match.blackPlayerId : match.whitePlayerId;
      startForfeitTimer(match.id, userId, opponentId);
      // Pause the move clock too, whether or not it's currently this user's turn — see
      // pauseMoveClock's own comment for why it doesn't matter whose turn it is here.
      await pauseMoveClock(match.id);
    }
  });
}
