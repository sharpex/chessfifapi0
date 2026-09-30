/** Tracks which members currently have an open socket connection. A plain in-memory Map
 *  is fine for a single server process; a real deployment with multiple API instances
 *  would back this with Redis instead (each instance's socket.io adapter would also need
 *  to move to the Redis adapter at that point) — noted here rather than over-built now.
 *
 *  One user can have more than one open tab/device, hence Set<socketId> rather than a
 *  single socketId — they're only "offline" once every one of those closes. */
const onlineUsers = new Map(); // userId -> Set<socketId>

/** Returns true if this is the user's first open connection (i.e. they just came online) —
 *  callers use this to decide whether to broadcast a presence change, mirroring how
 *  markOffline already reports the same thing for the opposite transition. A second tab
 *  opening while the first is still connected returns false — nothing about their overall
 *  online status actually changed. */
export function markOnline(userId, socketId) {
  const wasOnline = onlineUsers.has(userId);
  if (!wasOnline) onlineUsers.set(userId, new Set());
  onlineUsers.get(userId).add(socketId);
  return !wasOnline;
}

/** Returns true if that was the user's last open connection (i.e. they just went fully
 *  offline) — callers use this to decide whether to broadcast a disconnect. */
export function markOffline(userId, socketId) {
  const sockets = onlineUsers.get(userId);
  if (!sockets) return false;
  sockets.delete(socketId);
  if (sockets.size === 0) {
    onlineUsers.delete(userId);
    return true;
  }
  return false;
}

export function isOnline(userId) {
  return onlineUsers.has(userId);
}

export function getOnlineUserIds() {
  return [...onlineUsers.keys()];
}
