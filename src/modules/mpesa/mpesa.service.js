import crypto from 'node:crypto';
import { Op } from 'sequelize';
import { sequelize, Wallet, WagerAccount, Transaction, MpesaTransaction, User } from '../../models/index.js';
import { ApiError } from '../../utils/ApiError.js';
import { env } from '../../config/env.js';
import { emitToUser } from '../../sockets/ioRegistry.js';
import { sendPushToUser } from '../../utils/webPush.js';
import { comparePassword } from '../../utils/password.js';
import * as mpesa from '../../utils/mpesa.js';
import {
  MPESA_PLATFORM_FEE_PERCENT,
  MPESA_MIN_NET_WITHDRAWAL,
  MPESA_B2C_FEE_BANDS,
  isMpesaFeeScheduleConfigured,
  calculateMpesaWithdrawalFees,
  getMinimumMpesaWithdrawalAmount
} from '../../utils/mpesaFees.js';

/** The M-Pesa (Daraja Paybill) rail: STK Push deposits and B2C withdrawals. A self-contained
 *  sibling of modules/wallet/wallet.service.js (the Paystack rail) — it deliberately shares
 *  no functions with it, only the underlying Wallet/Transaction tables, so either rail can
 *  change or be removed without touching the other. The wallet-moving blocks below
 *  therefore repeat the same row-locking + ledger pattern that file uses, on purpose. */

/* ---------------- Public config (for the frontend) ---------------- */

/** What the frontend needs to render the M-Pesa forms — most importantly the B2C fee bands,
 *  which are operator-configured (see utils/mpesaFees.js), so the client fetches them
 *  instead of carrying a copy that could drift from this server's .env. The last band's
 *  max is null (JSON has no Infinity). */
export function getPublicConfig() {
  return {
    depositsEnabled: mpesa.isDepositConfigured(),
    withdrawalsEnabled: mpesa.isWithdrawalConfigured() && isMpesaFeeScheduleConfigured(),
    platformFeePercent: MPESA_PLATFORM_FEE_PERCENT,
    minNetWithdrawal: MPESA_MIN_NET_WITHDRAWAL,
    minWithdrawalAmount: getMinimumMpesaWithdrawalAmount(),
    maxTransaction: env.mpesa.maxTransaction,
    b2cFeeBands: MPESA_B2C_FEE_BANDS.map(b => ({ max: Number.isFinite(b.max) ? b.max : null, fee: b.fee }))
  };
}

/* ---------------- Small helpers ---------------- */

function assertWholeAmount(amount) {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new ApiError(400, 'M-Pesa amounts must be whole shillings (no cents).');
  }
  if (amount > env.mpesa.maxTransaction) {
    throw new ApiError(400, `The maximum per M-Pesa transaction is KSh ${env.mpesa.maxTransaction.toLocaleString('en-KE')}.`);
  }
}

function requireValidPhone(phoneNumber) {
  const phone = mpesa.normalizeMsisdn(phoneNumber);
  if (!phone) throw new ApiError(400, 'Enter a valid Safaricom number, e.g. 0712 345 678.');
  return phone;
}

function maskPhone(phone) {
  return `${phone.slice(0, 5)}****${phone.slice(-3)}`;
}

/** Daraja's numeric ResultCodes -> something a person can act on. Anything unlisted falls
 *  back to Safaricom's own description. */
function describeStkFailure(resultCode, resultDesc) {
  switch (String(resultCode)) {
    case '1032': return 'You cancelled the M-Pesa prompt.';
    case '1037': return "The M-Pesa prompt timed out — you didn't enter your PIN in time.";
    case '2001': return 'Wrong M-Pesa PIN entered.';
    case '1': return 'Your M-Pesa balance is too low for this payment.';
    default: return resultDesc || 'The M-Pesa payment did not go through.';
  }
}

/** Same re-authentication gate the Paystack withdrawal has (see wallet.service.js) — a
 *  valid session isn't proof the account owner is the one moving money right now. Repeated
 *  here rather than shared so the two rails stay independent. */
async function requirePassword(userId, password) {
  if (!password) throw new ApiError(400, 'Enter your password to confirm this withdrawal.');
  const user = await User.findByPk(userId);
  if (!user) throw new ApiError(404, 'Account not found.');
  if (!user.passwordHash) {
    throw new ApiError(400, 'Your account was created via social sign-in and has no password set — set a password on your account before you can withdraw.');
  }
  if (!(await comparePassword(password, user.passwordHash))) {
    throw new ApiError(401, 'Incorrect password.');
  }
}

async function ledgerEscrowBalance(userId, t) {
  return (await WagerAccount.findOne({ where: { userId }, transaction: t })).escrowBalance;
}

/* ---------------- Deposits (STK Push) ---------------- */

/** Sends an M-Pesa PIN prompt to the member's phone. Returns as soon as Safaricom accepts
 *  the request — the wallet is credited later, when the payment is confirmed (callback,
 *  status poll, or the background reconciler; whichever gets there first). */
export async function initiateDeposit(userId, { amount, phoneNumber }) {
  mpesa.assertDepositConfigured();
  assertWholeAmount(amount);
  const phone = requireValidPhone(phoneNumber);

  // One live prompt at a time — stops a double-tap (or a script) stacking several PIN
  // prompts on someone's phone, each of which would be a separate charge if approved.
  const live = await MpesaTransaction.findOne({
    where: { userId, kind: 'deposit', status: 'pending', createdAt: { [Op.gt]: new Date(Date.now() - 90_000) } }
  });
  if (live) {
    throw new ApiError(409, 'You already have an M-Pesa prompt waiting on your phone — complete it, or wait a minute and try again.');
  }

  const reference = crypto.randomUUID();
  const txn = await MpesaTransaction.create({ userId, kind: 'deposit', reference, phoneNumber: phone, amount, status: 'pending' });

  try {
    const push = await mpesa.initiateStkPush({ phoneNumber: phone, amount });
    txn.merchantRequestId = push.merchantRequestId;
    txn.checkoutRequestId = push.checkoutRequestId;
    await txn.save();
    return { reference, customerMessage: push.customerMessage || 'Check your phone and enter your M-Pesa PIN.' };
  } catch (err) {
    await MpesaTransaction.update(
      { status: 'failed', failureReason: String(err.message || 'Could not start the M-Pesa payment').slice(0, 255) },
      { where: { id: txn.id, status: 'pending' } }
    );
    throw err;
  }
}

/** Credits the wallet for a deposit — but only once, and only if it's still pending, which
 *  is what makes it safe for the callback, the status poll and the reconciler to all race
 *  to call it. Credits what WE recorded charging (the STK amount is fixed by our request),
 *  never a figure taken from an inbound payload. */
async function creditDeposit(txnId, { receipt } = {}) {
  const result = await sequelize.transaction(async t => {
    const txn = await MpesaTransaction.findByPk(txnId, { lock: t.LOCK.UPDATE, transaction: t });
    if (!txn || txn.kind !== 'deposit') return null;
    const wallet = await Wallet.findOne({ where: { userId: txn.userId }, lock: t.LOCK.UPDATE, transaction: t });
    if (!wallet) throw new ApiError(404, 'Wallet not found.');
    if (txn.status !== 'pending') {
      return { userId: txn.userId, balance: Number(wallet.balance), alreadyProcessed: true };
    }

    wallet.balance = Number(wallet.balance) + Number(txn.amount);
    await wallet.save({ transaction: t });
    txn.status = 'success';
    txn.failureReason = null;
    if (receipt) txn.mpesaReceipt = String(receipt).slice(0, 40);
    await txn.save({ transaction: t });
    await Transaction.create(
      {
        userId: txn.userId,
        type: 'deposit',
        amount: txn.amount,
        walletBalanceAfter: wallet.balance,
        escrowBalanceAfter: await ledgerEscrowBalance(txn.userId, t)
      },
      { transaction: t }
    );
    return { userId: txn.userId, balance: Number(wallet.balance), alreadyProcessed: false };
  });

  // Same socket push the Paystack rail uses, so a second tab / the wallet badge updates
  // regardless of which tab (or the server-side callback) resolved it.
  if (result && !result.alreadyProcessed) emitToUser(result.userId, 'wallet:balance', { balance: result.balance });
  return result;
}

async function failDeposit(txnId, reason) {
  await MpesaTransaction.update(
    { status: 'failed', failureReason: String(reason).slice(0, 255) },
    { where: { id: txnId, status: 'pending' } }
  );
}

/** Asks Safaricom directly what happened and settles accordingly. Only definitive answers
 *  change anything — 'pending' (still being processed) leaves the row alone. Throws on
 *  transient errors so callers can leave it pending and try again later. */
async function reconcileDeposit(txn) {
  if (!txn.checkoutRequestId || txn.status !== 'pending') return;
  const verified = await mpesa.queryStkStatus(txn.checkoutRequestId);
  if (verified.state === 'success') await creditDeposit(txn.id);
  else if (verified.state === 'failed') await failDeposit(txn.id, describeStkFailure(verified.resultCode, verified.resultDesc));
}

const lastReconcileAt = new Map(); // reference -> ms; throttles status-poll-driven queries

/** What the deposit modal polls while the member is looking at their phone. If it's still
 *  pending after a few seconds, this nudges a real check with Safaricom (throttled) so a
 *  missed callback can't leave the modal hanging. */
export async function getDepositStatus(userId, reference) {
  const txn = await MpesaTransaction.findOne({ where: { reference, userId, kind: 'deposit' } });
  if (!txn) throw new ApiError(404, 'Deposit not found.');

  const age = Date.now() - new Date(txn.createdAt).getTime();
  const sinceLast = Date.now() - (lastReconcileAt.get(reference) || 0);
  if (txn.status === 'pending' && age > 10_000 && sinceLast > 8_000) {
    lastReconcileAt.set(reference, Date.now());
    try {
      await reconcileDeposit(txn);
      await txn.reload();
    } catch (err) {
      console.warn('[mpesa] status-poll reconcile failed (leaving pending):', err.message);
    }
  }
  if (txn.status !== 'pending') lastReconcileAt.delete(reference);

  const wallet = txn.status === 'success' ? await Wallet.findOne({ where: { userId } }) : null;
  return {
    status: txn.status,
    failureReason: txn.status === 'failed' ? txn.failureReason : null,
    balance: wallet ? Number(wallet.balance) : undefined
  };
}

function extractStkMeta(callback) {
  const items = callback?.CallbackMetadata?.Item;
  const meta = {};
  if (Array.isArray(items)) for (const i of items) meta[i.Name] = i.Value;
  return { receipt: meta.MpesaReceiptNumber };
}

/** Safaricom POSTs the STK outcome here. The callback itself is deliberately NOT trusted
 *  to decide anything — it isn't signed, so anyone who learned the URL could post
 *  "ResultCode: 0". Instead it's just a prompt to ask Safaricom directly (reconcile) and
 *  act on THAT answer. A forged callback can therefore do nothing worse than trigger one
 *  extra status query. If the query can't answer yet, the row stays pending and the
 *  reconciler / status poll finishes it moments later. */
export async function handleStkCallback(body) {
  const cb = body?.Body?.stkCallback;
  if (!cb?.CheckoutRequestID) {
    console.warn('[mpesa] STK callback with no CheckoutRequestID ignored');
    return;
  }
  const txn = await MpesaTransaction.findOne({ where: { checkoutRequestId: cb.CheckoutRequestID, kind: 'deposit' } });
  if (!txn) {
    console.warn(`[mpesa] STK callback for unknown CheckoutRequestID ${cb.CheckoutRequestID}`);
    return;
  }
  if (txn.status !== 'pending') return;

  try {
    const verified = await mpesa.queryStkStatus(txn.checkoutRequestId);
    if (verified.state === 'success') {
      // The receipt code only exists in the callback payload, so keep it — but only from a
      // callback that itself reported success, and only after Safaricom confirmed it.
      const receipt = Number(cb.ResultCode) === 0 ? extractStkMeta(cb).receipt : undefined;
      await creditDeposit(txn.id, { receipt });
    } else if (verified.state === 'failed') {
      await failDeposit(txn.id, describeStkFailure(verified.resultCode, verified.resultDesc));
    }
  } catch (err) {
    console.warn('[mpesa] could not verify STK callback yet — leaving pending for the reconciler:', err.message);
  }
}

/* ---------------- Withdrawals (B2C) ---------------- */

/** Pays out to a phone. Wallet is debited up front (row-locked, so two racing requests
 *  can't both pass the balance check), then Daraja is asked to send the NET amount —
 *  requested minus the platform fee minus Safaricom's B2C charge, both of which the member
 *  bears (see utils/mpesaFees.js). The final outcome arrives asynchronously at the result
 *  callback (handleB2CResult), which either marks it paid or refunds the debit. */
export async function initiateWithdrawal(userId, { amount, phoneNumber, password }) {
  mpesa.assertWithdrawalConfigured();
  if (!isMpesaFeeScheduleConfigured()) {
    throw new ApiError(503, "M-Pesa withdrawals aren't fully set up on this server yet (no B2C fee schedule configured).");
  }

  await requirePassword(userId, password);

  assertWholeAmount(amount);
  const minimum = getMinimumMpesaWithdrawalAmount();
  if (minimum === null || amount < minimum) {
    throw new ApiError(400, `The minimum M-Pesa withdrawal is KSh ${minimum}, so that after fees you still receive at least KSh ${MPESA_MIN_NET_WITHDRAWAL}.`);
  }
  const phone = requireValidPhone(phoneNumber);

  const { platformFee, mpesaFee, netAmount } = calculateMpesaWithdrawalFees(amount);
  if (netAmount <= 0) {
    throw new ApiError(400, 'After fees, that amount leaves nothing to send — try withdrawing more.');
  }

  // Doubles as Daraja's OriginatorConversationID (idempotency key) — see initiateB2C.
  const reference = crypto.randomUUID();

  const { balanceAfterDebit } = await sequelize.transaction(async t => {
    const wallet = await Wallet.findOne({ where: { userId }, lock: t.LOCK.UPDATE, transaction: t });
    if (!wallet) throw new ApiError(404, 'Wallet not found.');
    if (Number(wallet.balance) < amount) throw new ApiError(400, "You can't withdraw more than your available balance.");
    wallet.balance = Number(wallet.balance) - amount;
    await wallet.save({ transaction: t });
    await MpesaTransaction.create(
      { userId, kind: 'withdrawal', reference, phoneNumber: phone, amount, platformFee, mpesaFee, netAmount, status: 'pending' },
      { transaction: t }
    );
    await Transaction.create(
      {
        userId,
        type: 'withdrawal',
        amount,
        walletBalanceAfter: wallet.balance,
        escrowBalanceAfter: await ledgerEscrowBalance(userId, t)
      },
      { transaction: t }
    );
    return { balanceAfterDebit: Number(wallet.balance) };
  });

  // The network call happens outside the DB transaction so it can't hold the wallet row
  // lock open while waiting on Safaricom.
  let accepted = null;
  try {
    accepted = await mpesa.initiateB2C({ originatorConversationId: reference, phoneNumber: phone, amount: netAmount });
  } catch (err) {
    if (err.definitive) {
      // Safaricom explicitly said no (or we never reached it) — nothing was sent, so the
      // debit can safely be handed straight back.
      await refundWithdrawal(reference, err.message);
      throw err;
    }
    // Ambiguous: the request may or may not have reached Safaricom. Refunding here could
    // pay the member twice (refund + a payout that actually went through), so leave the
    // debit in place and let the result callback settle it. If no callback ever arrives
    // this needs manual reconciliation, which is what the failureReason flags.
    console.error(`[mpesa] B2C request ${reference} outcome unknown (${err.message}) — left pending, needs reconciliation if no callback arrives`);
    await MpesaTransaction.update(
      { failureReason: 'Request outcome unknown — awaiting Safaricom result; reconcile manually if none arrives' },
      { where: { reference } }
    ).catch(() => {});
  }

  if (accepted?.conversationId) {
    await MpesaTransaction.update({ conversationId: accepted.conversationId }, { where: { reference } })
      .catch(e => console.warn('[mpesa] could not save conversationId:', e.message));
  }

  return { balance: balanceAfterDebit, status: 'processing', requestedAmount: amount, platformFee, mpesaFee, netAmount };
}

/** Hands a withdrawal's debit back and marks it failed — only if it's still pending, so a
 *  duplicate/late callback can never refund twice. Returns null when there was nothing to
 *  refund. Mirrors the Paystack rail's refundFailedWithdrawal, on this rail's own table. */
async function refundWithdrawal(reference, reason) {
  const result = await sequelize.transaction(async t => {
    const txn = await MpesaTransaction.findOne({ where: { reference, kind: 'withdrawal' }, lock: t.LOCK.UPDATE, transaction: t });
    if (!txn || txn.status !== 'pending') return null;
    const wallet = await Wallet.findOne({ where: { userId: txn.userId }, lock: t.LOCK.UPDATE, transaction: t });
    if (!wallet) return null;
    wallet.balance = Number(wallet.balance) + Number(txn.amount);
    await wallet.save({ transaction: t });
    txn.status = 'failed';
    txn.failureReason = String(reason || 'Withdrawal failed').slice(0, 255);
    await txn.save({ transaction: t });
    await Transaction.create(
      {
        userId: txn.userId,
        type: 'withdrawal_refund',
        amount: txn.amount,
        walletBalanceAfter: wallet.balance,
        escrowBalanceAfter: await ledgerEscrowBalance(txn.userId, t)
      },
      { transaction: t }
    );
    return { userId: txn.userId, balance: Number(wallet.balance), amount: Number(txn.amount) };
  });
  if (result) emitToUser(result.userId, 'wallet:balance', { balance: result.balance });
  return result;
}

/** Finds the withdrawal a B2C callback refers to. Matches on our own id first (we supplied
 *  it as OriginatorConversationID), then Safaricom's ConversationID as a fallback. The
 *  clause list is built conditionally because Sequelize throws on an undefined value. */
async function findWithdrawalForCallback(result) {
  const clauses = [];
  if (result?.OriginatorConversationID) clauses.push({ reference: result.OriginatorConversationID });
  if (result?.ConversationID) clauses.push({ conversationId: result.ConversationID });
  if (clauses.length === 0) return null;
  return MpesaTransaction.findOne({ where: { kind: 'withdrawal', [Op.or]: clauses } });
}

function extractResultParams(result) {
  const list = result?.ResultParameters?.ResultParameter;
  const params = {};
  if (Array.isArray(list)) for (const p of list) params[p.Key] = p.Value;
  return params;
}

/** Safaricom's final answer on a B2C payout. Unlike STK there's no query to double-check
 *  this against, so the callback IS trusted — which is why it's only reachable at the
 *  secret URL (see mpesa.controller.js). Success marks the payout paid; any failure code
 *  refunds the debit. Both are idempotent (only a still-pending row is touched). */
export async function handleB2CResult(body) {
  const result = body?.Result;
  if (!result) {
    console.warn('[mpesa] B2C result callback with no Result ignored');
    return;
  }
  const txn = await findWithdrawalForCallback(result);
  if (!txn) {
    console.warn(`[mpesa] B2C result for unknown withdrawal (Originator ${result.OriginatorConversationID}, Conversation ${result.ConversationID})`);
    return;
  }
  if (txn.status !== 'pending') return;

  if (Number(result.ResultCode) === 0) {
    const params = extractResultParams(result);
    const receipt = params.TransactionReceipt || result.TransactionID || null;
    const paid = Number(params.TransactionAmount);
    if (Number.isFinite(paid) && paid !== Number(txn.netAmount)) {
      // Not something to act on automatically, but worth a loud log — the payout succeeded
      // for a different amount than we asked for.
      console.error(`[mpesa] withdrawal ${txn.reference}: paid ${paid} but expected net ${txn.netAmount}`);
    }
    await MpesaTransaction.update(
      { status: 'success', mpesaReceipt: receipt ? String(receipt).slice(0, 40) : null, failureReason: null },
      { where: { id: txn.id, status: 'pending' } }
    );
    sendPushToUser(txn.userId, {
      title: 'M-Pesa withdrawal sent',
      body: `KSh ${Number(txn.netAmount).toLocaleString('en-KE')} was sent to ${maskPhone(txn.phoneNumber)}.`,
      data: { type: 'mpesa:withdrawal', status: 'success' }
    });
    return;
  }

  const refunded = await refundWithdrawal(txn.reference, result.ResultDesc || `M-Pesa could not complete the payout (code ${result.ResultCode}).`);
  if (refunded) {
    sendPushToUser(txn.userId, {
      title: 'M-Pesa withdrawal failed',
      body: `Your KSh ${Number(txn.netAmount).toLocaleString('en-KE')} withdrawal couldn't be completed. KSh ${refunded.amount.toLocaleString('en-KE')} was returned to your wallet.`,
      data: { type: 'mpesa:withdrawal', status: 'failed' }
    });
  }
}

/** Safaricom's queue-timeout notification: the payout request timed out waiting to be
 *  processed. Deliberately NOT treated as a failure — it isn't certain from this callback
 *  alone that the money didn't move, and refunding a payout that actually went through
 *  means paying the member twice. The row is left pending with a note; if a result
 *  callback follows it settles normally, otherwise it needs manual reconciliation against
 *  the Paybill statement. */
export async function handleB2CTimeout(body) {
  const result = body?.Result;
  const txn = result ? await findWithdrawalForCallback(result) : null;
  if (!txn) {
    console.warn('[mpesa] B2C timeout callback for unknown withdrawal');
    return;
  }
  if (txn.status !== 'pending') return;
  console.warn(`[mpesa] B2C queue timeout for withdrawal ${txn.reference} — left pending, verify against the Paybill statement`);
  await MpesaTransaction.update(
    { failureReason: 'Safaricom reported a queue timeout — verify against the Paybill statement before refunding' },
    { where: { id: txn.id, status: 'pending' } }
  );
}

/* ---------------- Background reconciler ---------------- */

/** Settles deposits whose callback never arrived (or arrived before Safaricom could
 *  confirm it) by asking Safaricom directly. Only touches deposits between 30 seconds and
 *  24 hours old — younger ones are still with the customer's PIN prompt, and older ones
 *  are past the point a query is useful. Bounded per pass so a backlog can't hammer the API. */
export async function reconcilePendingDeposits() {
  const pending = await MpesaTransaction.findAll({
    where: {
      kind: 'deposit',
      status: 'pending',
      checkoutRequestId: { [Op.ne]: null },
      createdAt: { [Op.between]: [new Date(Date.now() - 24 * 60 * 60 * 1000), new Date(Date.now() - 30_000)] }
    },
    order: [['createdAt', 'ASC']],
    limit: 25
  });
  for (const txn of pending) {
    try {
      await reconcileDeposit(txn);
    } catch (err) {
      console.warn(`[mpesa] reconcile of ${txn.reference} failed (will retry):`, err.message);
    }
  }
}

/** In-process interval, same caveat as the app's other timers: fine for a single server;
 *  multiple instances would each run it (harmless — settling is idempotent — just
 *  redundant queries). Does nothing unless deposits are configured. */
export function startMpesaReconciler() {
  if (!mpesa.isDepositConfigured()) return;
  const timer = setInterval(() => {
    reconcilePendingDeposits().catch(err => console.error('[mpesa] reconciler pass failed:', err.message));
  }, 60_000);
  timer.unref?.();
}
