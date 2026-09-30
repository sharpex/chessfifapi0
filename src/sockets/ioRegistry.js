/** Services (challenge.service.js, match.service.js) need to emit socket events as a
 *  side effect of a REST call — e.g. accepting a challenge over HTTP still needs to push
 *  'challenge:accepted' to the creator's live socket. Importing sockets/index.js directly
 *  from a service would create a circular import (sockets/index.js registers handlers
 *  that call back into these same services), so instead sockets/index.js calls setIO()
 *  once at startup and everything else calls getIO(). */
let io = null;

export function setIO(instance) {
  io = instance;
}

export function getIO() {
  return io;
}

/** Emits to every open socket for a given user (see presence.js — one user can have
 *  several). No-ops quietly if they're not currently connected, which is the normal
 *  case for most events (the recipient finds out via REST polling instead). */
export function emitToUser(userId, event, payload) {
  if (!io) return;
  io.to(`user:${userId}`).emit(event, payload);
}

/** Emits to every connected socket, guests included (see socketAuth.js — the socket
 *  layer itself allows anonymous connections precisely so public broadcasts like this one
 *  can reach them, even though most events are still only ever sent to a specific
 *  authenticated user via emitToUser above). Used for lobby-wide announcements — e.g. a
 *  new open challenge appearing for anyone browsing, logged in or not. */
export function broadcastToAll(event, payload) {
  if (!io) return;
  io.emit(event, payload);
}
