import { Router } from 'express';
import crypto from 'node:crypto';
import { env } from '../../config/env.js';
import { ApiError } from '../../utils/ApiError.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as mpesaController from '../mpesa/mpesa.controller.js';

/** Public endpoints Safaricom itself calls — never the frontend. Deliberately mounted at
 *  /pay-hooks rather than /mpesa/... : Safaricom's callback-URL validation has been known
 *  to reject URLs containing words like "mpesa", "safaricom", "exec", "cmd", "sql" or
 *  "query" — see utils/mpesa.js's callbackUrl, which is the only place these paths are
 *  built, so this file and that function must always agree on the shape.
 *
 *  Daraja callbacks carry no signature the way Paystack's webhook does (no HMAC header to
 *  verify), so the :secret segment matching MPESA_CALLBACK_SECRET IS the authentication —
 *  checked here, before any handler runs, with a constant-time comparison so responding to
 *  a wrong-length guess can't leak how much of the secret was right. */
const router = Router();

const verifySecret = asyncHandler(async (req, res, next) => {
  const expected = Buffer.from(env.mpesa.callbackSecret || '');
  const given = Buffer.from(req.params.secret || '');
  const ok = expected.length > 0 && expected.length === given.length && crypto.timingSafeEqual(expected, given);
  if (!ok) throw new ApiError(404, 'Not found'); // 404, not 401/403 — don't confirm this path exists to a guesser
  next();
});

router.post('/:secret/stk', verifySecret, mpesaController.stkCallback);
router.post('/:secret/b2c-result', verifySecret, mpesaController.b2cResult);
router.post('/:secret/b2c-timeout', verifySecret, mpesaController.b2cTimeout);

export default router;
