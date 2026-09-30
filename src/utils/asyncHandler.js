/** Wraps an async Express handler so a rejected promise reaches errorHandler instead of
 *  hanging the request — Express 4 doesn't do this automatically for async functions. */
export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}
