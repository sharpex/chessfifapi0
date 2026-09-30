import * as matchService from '../modules/matches/match.service.js';
import { emitToUser } from './ioRegistry.js';

/** matchId -> { timeoutHandle, disconnectedUserId }. One timer per match, not per user —
 *  a match only ever has one side disconnected at a time in practice, and this keeps the
 *  bookkeeping simple. In-memory only: fine for a single server process; a multi-instance
 *  deployment would need this moved to a persistent/shared job scheduler (e.g. a Redis-
 *  backed queue) so a server restart mid-window doesn't silently drop the forfeit clock. */
const RECONNECT_WINDOW_MS = Number(process.env.RECONNECT_WINDOW_MS || 5 * 60 * 1000);
const pendingForfeits = new Map();

export function startForfeitTimer(matchId, disconnectedUserId, opponentId) {
  if (pendingForfeits.has(matchId)) return; // already counting down for this match
  const timeoutHandle = setTimeout(async () => {
    pendingForfeits.delete(matchId);
    await matchService.forfeitByConnectionTimeout(matchId, disconnectedUserId);
    // notifyMatchEnded (inside settleMatch) already emits 'match:ended' to both players
    // with the final outcome — nothing further to broadcast here.
  }, RECONNECT_WINDOW_MS);

  pendingForfeits.set(matchId, { timeoutHandle, disconnectedUserId });
  emitToUser(opponentId, 'opponent:disconnected', { matchId });
}

/** Called when the disconnected player's userId reconnects (any socket, any tab) — see
 *  connectionHandler.js. Cancels the countdown and lets the match continue. */
export function cancelForfeitTimer(matchId, reconnectedUserId, opponentId) {
  const pending = pendingForfeits.get(matchId);
  if (!pending || pending.disconnectedUserId !== reconnectedUserId) return;
  clearTimeout(pending.timeoutHandle);
  pendingForfeits.delete(matchId);
  emitToUser(opponentId, 'opponent:reconnected', { matchId });
}

export function hasPendingForfeit(matchId) {
  return pendingForfeits.has(matchId);
}
