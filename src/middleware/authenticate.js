import { verifyToken } from '../utils/jwt.js';
import { ApiError } from '../utils/ApiError.js';
import { User } from '../models/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';

/** Requires a valid `Authorization: Bearer <token>` header. Attaches the authenticated
 *  user to req.user. The frontend's apiRequest() needs one addition to send this header
 *  once it has a token — see README "Wiring this up to the existing frontend". */
export const authenticate = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new ApiError(401, 'Sign in required.');

  const payload = verifyToken(token); // throws JsonWebTokenError/TokenExpiredError -> errorHandler
  const user = await User.findByPk(payload.sub);
  if (!user) throw new ApiError(401, 'Sign in required.');

  req.user = user;
  next();
});

/** Same as authenticate, but doesn't reject when there's no token — just leaves req.user
 *  undefined. Used by endpoints that behave sensibly for both guests and members. */
export const authenticateOptional = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next();
  try {
    const payload = verifyToken(token);
    req.user = await User.findByPk(payload.sub);
  } catch (err) {
    // Invalid/expired token on an optional route — treat as a guest rather than failing.
  }
  next();
});
