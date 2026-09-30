import * as walletService from './wallet.service.js';
import { paystack } from '../../utils/paystack.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/ApiError.js';

export const getMyWallet = asyncHandler(async (req, res) => {
  const balances = await walletService.getBalances(req.user.id);
  res.json(balances);
});

/** Matches frontend: walletApi.initializeDeposit(amount) -> POST /wallet/deposit/initialize.
 *  Starts a Paystack transaction and hands back what the frontend needs to open the
 *  Inline popup (or redirect to authorizationUrl as a fallback). */
export const initializeDeposit = asyncHandler(async (req, res) => {
  const { amount } = req.body;
  const result = await walletService.initializeDeposit(req.user.id, Number(amount));
  res.json(result);
});

/** Matches frontend: walletApi.verifyDeposit(reference) -> POST /wallet/deposit/verify.
 *  Called right after the Paystack popup reports success, for immediate UI feedback — the
 *  webhook below is what's actually authoritative and resolves the same reference
 *  independently, so this is safe to call even if the webhook already landed. */
export const verifyDeposit = asyncHandler(async (req, res) => {
  const { reference } = req.body;
  if (!reference) throw new ApiError(400, 'Missing reference.');
  const result = await walletService.confirmDeposit(reference);
  res.json(result);
});

/** Matches frontend: walletApi.initializeWithdrawal({...}) -> POST /wallet/withdraw/initialize. */
export const initializeWithdrawal = asyncHandler(async (req, res) => {
  const { amount, bankCode, accountNumber, accountName, password } = req.body;
  const result = await walletService.initializeWithdrawal(req.user.id, {
    amount: Number(amount),
    bankCode,
    accountNumber,
    accountName,
    password
  });
  res.json(result);
});

/** Bank list for the withdrawal form's dropdown. */
export const getBanks = asyncHandler(async (req, res) => {
  const banks = await paystack.listBanks();
  res.json({ banks: banks.map(b => ({ name: b.name, code: b.code })) });
});

/** Confirms an account number/bank pair resolves to a real account before the withdrawal
 *  form is submitted, so a typo surfaces immediately instead of after the transfer fails. */
export const resolveAccount = asyncHandler(async (req, res) => {
  const { accountNumber, bankCode } = req.query;
  if (!accountNumber || !bankCode) throw new ApiError(400, 'accountNumber and bankCode are required.');
  const result = await paystack.resolveAccountNumber({ accountNumber, bankCode });
  res.json({ accountName: result.account_name });
});

/** Paystack's server-to-server event notification. Not behind `authenticate` — Paystack
 *  isn't a signed-in user — verified instead by the HMAC signature below, which is why
 *  app.js keeps the raw request body around (req.rawBody) specifically for this route. */
export const paystackWebhook = asyncHandler(async (req, res) => {
  const signature = req.headers['x-paystack-signature'];
  if (!paystack.verifyWebhookSignature(req.rawBody, signature)) {
    throw new ApiError(401, 'Invalid signature.');
  }

  const event = req.body;
  if (event.event === 'charge.success') {
    await walletService.confirmDeposit(event.data.reference);
  } else if (event.event === 'transfer.success') {
    await walletService.confirmWithdrawalSuccess(event.data.reference);
  } else if (event.event === 'transfer.failed' || event.event === 'transfer.reversed') {
    await walletService.refundFailedWithdrawal(event.data.reference, event.data.reason || event.event);
  }
  // Any other event type isn't one we act on — still acknowledge it so Paystack doesn't
  // keep retrying a webhook we were never going to do anything with.
  res.sendStatus(200);
});
