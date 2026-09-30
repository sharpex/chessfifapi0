import { validationResult } from 'express-validator';
import { ApiError } from '../utils/ApiError.js';

/** Drop this after any express-validator chain (see auth.routes.js for usage) — collects
 *  whatever the chain found and throws a single readable 400 instead of leaving each
 *  route to check validationResult() itself. */
export function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new ApiError(400, errors.array()[0].msg);
  }
  next();
}
