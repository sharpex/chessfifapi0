import { ApiError } from '../utils/ApiError.js';

/** Must be registered last, after all routes (see app.js). Express recognizes it as an
 *  error handler by its 4-argument signature. */
export function errorHandler(err, req, res, next) {
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({ message: err.message });
  }

  if (err.name === 'SequelizeValidationError' || err.name === 'SequelizeUniqueConstraintError') {
    const message = err.errors?.[0]?.message || 'Validation failed';
    return res.status(400).json({ message });
  }

  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return res.status(401).json({ message: 'Invalid or expired session — please sign in again.' });
  }

  // Unexpected — log the real error server-side, never leak internals to the client.
  console.error(err);
  res.status(500).json({ message: 'Something went wrong. Please try again.' });
}
