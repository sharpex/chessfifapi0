import { verifyToken } from '../../utils/jwt.js';
import { User } from '../../models/index.js';

/** Most of what the socket layer does is per-member (matches, personal challenge
 *  notifications), but some of it is genuinely public — the live "new challenge posted"
 *  broadcast guests can see in the lobby, for one — so a connection isn't rejected just for
 *  arriving with no token. A valid token still authenticates normally and gets socket.userId
 *  set; without one, the connection proceeds as a guest with socket.userId left undefined.
 *  connectionHandler.js is what actually guards the user-specific bookkeeping (presence,
 *  per-user room, reconnect/forfeit tracking) behind that being set — this middleware's job
 *  is only to attach identity when there is one, not to decide who's allowed to connect. */
export async function socketAuth(socket, next) {
  const token = socket.handshake.auth?.token;
  if (!token) return next(); // guest — no identity to attach

  try {
    const payload = verifyToken(token);
    const user = await User.findByPk(payload.sub);
    if (user) {
      socket.userId = user.id;
      socket.userName = user.name;
    }
    // An invalid/expired token falls through as a guest connection rather than rejecting
    // outright — the same as the frontend's own REST-side handling of a stale session
    // (see useMatchStore's handleSessionExpired): a bad token shouldn't block someone from
    // still seeing public, unauthenticated content like the open-challenges broadcast.
    next();
  } catch (err) {
    next();
  }
}
