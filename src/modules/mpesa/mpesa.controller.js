import * as mpesaService from './mpesa.service.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

/** Matches frontend: mpesaApi.getConfig() -> GET /mpesa/config. Public — tells the
 *  frontend whether to show the M-Pesa buttons at all, and the fee schedule to render, per
 *  getPublicConfig's own comment on why this is fetched rather than duplicated. */
export const getConfig = asyncHandler(async (req, res) => {
  res.json(mpesaService.getPublicConfig());
});

export const initiateDeposit = asyncHandler(async (req, res) => {
  const { amount, phoneNumber } = req.body;
  const result = await mpesaService.initiateDeposit(req.user.id, { amount: Math.round(Number(amount)), phoneNumber });
  res.json(result);
});

export const getDepositStatus = asyncHandler(async (req, res) => {
  const result = await mpesaService.getDepositStatus(req.user.id, req.params.reference);
  res.json(result);
});

export const initiateWithdrawal = asyncHandler(async (req, res) => {
  const { amount, phoneNumber, password } = req.body;
  const result = await mpesaService.initiateWithdrawal(req.user.id, { amount: Math.round(Number(amount)), phoneNumber, password });
  res.json(result);
});

/* ---------------- Safaricom callbacks (public — protected by the secret path segment) --- */
// Daraja doesn't sign these the way Paystack's webhook is HMAC-signed, so the URL itself
// (see utils/mpesa.js's callbackUrl, built from MPESA_CALLBACK_SECRET) is what stands in
// for authentication — mpesa.routes.js is what actually checks the segment matches before
// any of these run. Safaricom expects a 200 with this exact body regardless of what the
// handler below did with it — retried callbacks otherwise pile up on their side.
const ACK = { ResultCode: 0, ResultDesc: 'Accepted' };

export const stkCallback = asyncHandler(async (req, res) => {
  res.json(ACK); // ack first — Safaricom's timeout is short, and our own work doesn't need to hold the connection
  try {
    await mpesaService.handleStkCallback(req.body);
  } catch (err) {
    console.error('[mpesa] STK callback handling failed:', err.message);
  }
});

export const b2cResult = asyncHandler(async (req, res) => {
  res.json(ACK);
  try {
    await mpesaService.handleB2CResult(req.body);
  } catch (err) {
    console.error('[mpesa] B2C result handling failed:', err.message);
  }
});

export const b2cTimeout = asyncHandler(async (req, res) => {
  res.json(ACK);
  try {
    await mpesaService.handleB2CTimeout(req.body);
  } catch (err) {
    console.error('[mpesa] B2C timeout handling failed:', err.message);
  }
});
