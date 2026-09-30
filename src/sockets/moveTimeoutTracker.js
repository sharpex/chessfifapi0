import { MOVE_TIME_LIMIT_MS } from '../chess/constants.js';

/** matchId -> { timeoutHandle, turnUserId, deadline }. One clock per match, for whoever is
 *  currently on the move — started at match creation and restarted after every accepted
 *  move (see match.service.js/challenge.service.js), cleared the instant the match ends any
 *  other way. Same in-memory-only caveat as connectionTimeoutTracker.js: fine for a single
 *  server process; a multi-instance deployment would need this moved to a persistent/shared
 *  scheduler so a restart mid-turn doesn't silently drop the clock — match.turnDeadline is
 *  persisted precisely so a lost timer can still be caught and enforced on the next read or
 *  write for that match (see the expiry check in match.service.js's submitMove/getMatch)
 *  rather than quietly granting extra time forever.
 *
 *  No import of match.service.js here, even though the whole point of this module is to
 *  eventually call back into it — that would create a cycle, since match.service.js is the
 *  one starting/clearing these timers on every move. Instead match.service.js registers its
 *  own forfeit function once via setForfeitHandler, the same indirection ioRegistry.js uses
 *  for socket emission from the services. */
const pendingMoveTimers = new Map();
let forfeitHandler = null;

export function setForfeitHandler(fn) {
  forfeitHandler = fn;
}

/** Starts (or restarts) the clock for turnUserId on this match, returning the deadline so
 *  the caller can persist/return it alongside. Always clears any existing timer for this
 *  match first — a match only ever has one side "on the clock" at a time. durationMs
 *  defaults to the full per-move limit; match.service.js's resumeMoveClockIfBothOnline
 *  passes a shorter one to resume with whatever time was actually left rather than
 *  granting a fresh full clock after a pause. */
export function startMoveTimer(matchId, turnUserId, durationMs = MOVE_TIME_LIMIT_MS) {
  clearMoveTimer(matchId);
  const deadline = new Date(Date.now() + durationMs);
  const timeoutHandle = setTimeout(async () => {
    pendingMoveTimers.delete(matchId);
    if (forfeitHandler) await forfeitHandler(matchId, turnUserId);
  }, durationMs);
  pendingMoveTimers.set(matchId, { timeoutHandle, turnUserId, deadline });
  return deadline;
}

/** Called once a move is accepted (about to restart for the other side) or the match ends
 *  for any reason — resignation, checkmate, a connection-loss forfeit, or this timer firing
 *  itself. Safe to call when there's nothing pending. */
export function clearMoveTimer(matchId) {
  const pending = pendingMoveTimers.get(matchId);
  if (pending) {
    clearTimeout(pending.timeoutHandle);
    pendingMoveTimers.delete(matchId);
  }
}
