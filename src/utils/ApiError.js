/** Thrown deliberately by services/controllers for expected failure cases (validation,
 *  insufficient balance, not found, etc.) — errorHandler recognizes this class and uses
 *  its statusCode/message directly. Anything else thrown is treated as unexpected and
 *  logged with a generic 500 response instead of leaking internals to the client. */
export class ApiError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'ApiError';
  }
}
