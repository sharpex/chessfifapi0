import crypto from 'node:crypto';
import { sequelize, Wallet, WagerAccount, Transaction, PaystackTransaction, User } from '../../models/index.js';
import { ApiError } from '../../utils/ApiError.js';
import { paystack } from '../../utils/paystack.js';
import { env } from '../../config/env.js';
import { emitToUser } from '../../sockets/ioRegistry.js';
import { calculateWithdrawalFees, PLATFORM_FEE_RATE, MIN_WITHDRAWAL_AMOUNT, MIN_NET_WITHDRAWAL } from '../../utils/withdrawalFees.js';
import { comparePassword } from '../../utils/password.js';

/** All money movement in the app funnels through here. Every operation that changes a
 *  balance runs inside a Sequelize transaction with a row lock (`FOR UPDATE`) on the
 *  wallet/wager-account row it touches, and writes a Transaction audit row in the same
 *  DB transaction — so a balance and its paper trail can never drift apart, even under
 *  concurrent requests for the same user. */

/** Called once at signup (see auth.service.js) — every member gets exactly one Wallet
 *  and one WagerAccount, created together. `demoBonus` seeds a starting balance for
 *  local/staging use only (see DEMO_SIGNUP_BONUS in .env) — remove for production. */
export async function createAccountsForUser(userId, demoBonus = 0, t) {
  const wallet = await Wallet.create({ userId, balance: demoBonus }, { transaction: t });
  const wagerAccount = await WagerAccount.create({ userId }, { transaction: t });
  if (demoBonus > 0) {
    await Transaction.create(
      {
        userId,
        type: 'signup_bonus',
        amount: demoBonus,
        walletBalanceAfter: demoBonus,
        escrowBalanceAfter: 0
      },
      { transaction: t }
    );
  }
  return { wallet, wagerAccount };
}

export async function getBalances(userId) {
  const [wallet, wagerAccount] = await Promise.all([
    Wallet.findOne({ where: { userId } }),
    WagerAccount.findOne({ where: { userId } })
  ]);
  if (!wallet || !wagerAccount) throw new ApiError(404, 'Account not found.');
  return { balance: Number(wallet.balance), escrowBalance: Number(wagerAccount.escrowBalance) };
}

/** Starts a Paystack deposit. Persists a pending PaystackTransaction under a fresh
 *  reference *before* calling out to Paystack, so the reference exists to be looked up
 *  the moment either the webhook or the frontend's post-checkout verify call comes back —
 *  whichever of those arrives first is a race by design (see confirmDeposit). */
export async function initializeDeposit(userId, amount) {
  if (!(amount > 0)) throw new ApiError(400, 'Deposit amount must be greater than zero.');
  const user = await User.findByPk(userId);
  if (!user) throw new ApiError(404, 'Account not found.');
  if (!user.email) throw new ApiError(400, 'Add an email to your account before depositing — Paystack sends a receipt to it.');

  const reference = `dep_${crypto.randomUUID()}`;
  await PaystackTransaction.create({ userId, kind: 'deposit', reference, amount, status: 'pending' });

  const result = await paystack.initializeTransaction({
    email: user.email,
    amount,
    reference,
    callbackUrl: `${env.appBaseUrl}/wallet/deposit/callback`,
    metadata: { userId, purpose: 'wallet_deposit' }
  });

  return {
    reference,
    authorizationUrl: result.authorization_url,
    accessCode: result.access_code,
    publicKey: env.paystack.publicKey
  };
}

/** Resolves a deposit's outcome — shared by the Paystack webhook and the frontend's
 *  post-checkout verify call, whichever gets here first. Always re-verifies with Paystack
 *  directly (never trusts a webhook payload or a client's say-so on its own), and the row
 *  lock + status check below make the *second* caller a no-op rather than a double credit. */
export async function confirmDeposit(reference) {
  const verified = await paystack.verifyTransaction(reference);
  if (!verified || verified.status !== 'success') {
    await PaystackTransaction.update(
      { status: 'failed', failureReason: (verified && verified.gateway_response) || 'Payment not successful' },
      { where: { reference, status: 'pending' } }
    );
    throw new ApiError(400, 'Payment was not successful.');
  }

  return sequelize.transaction(async t => {
    const paystackTxn = await PaystackTransaction.findOne({ where: { reference }, lock: t.LOCK.UPDATE, transaction: t });
    if (!paystackTxn) throw new ApiError(404, 'Deposit not found.');
    if (paystackTxn.status !== 'pending') {
      // Already resolved by the other path — return the current balance instead of
      // crediting (or re-marking failed) a second time.
      const wallet = await Wallet.findOne({ where: { userId: paystackTxn.userId }, transaction: t });
      return { balance: Number(wallet.balance), alreadyProcessed: true };
    }

    // Trust what Paystack actually confirms was paid, not what we originally asked for —
    // guards against a reference being replayed with a mismatched amount.
    const paidAmount = paystack.fromSubunit(verified.amount);
    const wallet = await Wallet.findOne({ where: { userId: paystackTxn.userId }, lock: t.LOCK.UPDATE, transaction: t });
    if (!wallet) throw new ApiError(404, 'Wallet not found.');

    wallet.balance = Number(wallet.balance) + paidAmount;
    await wallet.save({ transaction: t });
    paystackTxn.status = 'success';
    paystackTxn.amount = paidAmount;
    await paystackTxn.save({ transaction: t });
    await Transaction.create(
      {
        userId: paystackTxn.userId,
        type: 'deposit',
        amount: paidAmount,
        walletBalanceAfter: wallet.balance,
        escrowBalanceAfter: (await WagerAccount.findOne({ where: { userId: paystackTxn.userId }, transaction: t })).escrowBalance
      },
      { transaction: t }
    );
    return { balance: Number(wallet.balance), alreadyProcessed: false, userId: paystackTxn.userId };
  }).then(result => {
    // Push the new balance over the socket too — covers the case where the webhook (not
    // the tab that opened the Paystack popup) is what resolves this, or the person has
    // more than one tab open.
    if (!result.alreadyProcessed) emitToUser(result.userId, 'wallet:balance', { balance: result.balance });
    return { balance: result.balance, alreadyProcessed: result.alreadyProcessed };
  });
}

/** Starts a withdrawal: debits the wallet immediately (inside its own DB transaction, so
 *  two withdrawal requests racing each other can't both pass the balance check), then
 *  registers a Paystack transfer recipient and sends the transfer. If either Paystack call
 *  fails, the balance is refunded before the error propagates — see refundFailedWithdrawal,
 *  which also handles the async case where Paystack accepts the transfer here but reports
 *  transfer.failed/transfer.reversed later via webhook.
 *
 *  `amount` is what leaves the member's wallet — the full amount they asked to withdraw.
 *  What Paystack is actually asked to SEND is less than that: a platform fee (see
 *  PLATFORM_FEE_RATE in utils/withdrawalFees.js) plus
 *  Paystack's own Kenya transfer fee (see utils/withdrawalFees.js) both come off first, so
 *  the member bears both rather than the platform quietly absorbing the Paystack side of
 *  it. See TermsModal/legal.service.js for the same breakdown explained to the member. */
export async function initializeWithdrawal(userId, { amount, bankCode, accountNumber, accountName, password }) {
  // Re-authentication gate, checked before anything else — a valid session/JWT proves
  // "someone with this device/browser open", not "the account owner is the one asking for
  // money to move right now" (a shared/unlocked device, a stolen session token, etc. all
  // pass that first bar). Requiring the password again here is the standard step-up-auth
  // pattern for a sensitive action, independent of whatever got them signed in originally.
  if (!password) throw new ApiError(400, 'Enter your password to confirm this withdrawal.');
  const user = await User.findByPk(userId);
  if (!user) throw new ApiError(404, 'Account not found.');
  if (!user.passwordHash) {
    // Signed up via Google/Facebook — see auth.service.js — so there's no password to
    // check against at all. This app has no "set a password" flow yet for an
    // OAuth-only account; until one exists, withdrawing is simply blocked for these
    // accounts rather than silently skipping the re-auth check (which would defeat the
    // whole point of it) or accepting some weaker substitute.
    throw new ApiError(400, 'Your account was created via social sign-in and has no password set — set a password on your account before you can withdraw.');
  }
  if (!(await comparePassword(password, user.passwordHash))) {
    throw new ApiError(401, 'Incorrect password.');
  }

  if (!(amount > 0)) throw new ApiError(400, 'Withdrawal amount must be greater than zero.');
  if (amount < MIN_WITHDRAWAL_AMOUNT) {
    throw new ApiError(400, `The minimum withdrawal is KSh ${MIN_WITHDRAWAL_AMOUNT} — below that, fees would leave you with less than KSh ${MIN_NET_WITHDRAWAL}.`);
  }
  if (!bankCode || !accountNumber || !accountName) throw new ApiError(400, 'Bank details are required to withdraw.');

  const { platformFee, paystackFee, netAmount } = calculateWithdrawalFees(amount);
  if (netAmount <= 0) {
    // Shouldn't be reachable given the MIN_WITHDRAWAL_AMOUNT check above, but kept as a
    // hard backstop against ever sending Paystack a zero/negative transfer amount if the
    // two ever drift out of sync.
    throw new ApiError(400, `After the ${PLATFORM_FEE_RATE * 100}% platform fee and Paystack's transfer fee, that amount leaves nothing to send — try withdrawing a larger amount.`);
  }

  const reference = `wd_${crypto.randomUUID()}`;

  const { balanceAfterDebit } = await sequelize.transaction(async t => {
    const wallet = await Wallet.findOne({ where: { userId }, lock: t.LOCK.UPDATE, transaction: t });
    if (!wallet) throw new ApiError(404, 'Wallet not found.');
    if (Number(wallet.balance) < amount) throw new ApiError(400, "You can't withdraw more than your available balance.");
    wallet.balance = Number(wallet.balance) - Number(amount);
    await wallet.save({ transaction: t });
    await PaystackTransaction.create(
      { userId, kind: 'withdrawal', reference, amount, platformFee, paystackFee, netAmount, status: 'pending', bankCode, accountNumber, accountName },
      { transaction: t }
    );
    await Transaction.create(
      {
        userId,
        type: 'withdrawal',
        amount,
        walletBalanceAfter: wallet.balance,
        escrowBalanceAfter: (await WagerAccount.findOne({ where: { userId }, transaction: t })).escrowBalance
      },
      { transaction: t }
    );
    return { balanceAfterDebit: Number(wallet.balance) };
  });

  // Recipient creation + transfer are network calls to Paystack and shouldn't hold a row
  // lock open, so these happen outside the transaction above.
  try {
    const recipient = await paystack.createTransferRecipient({ name: accountName, accountNumber, bankCode });
    // netAmount, not amount — see this function's own comment above. What Paystack is
    // asked to send is already net of both fees.
    const transfer = await paystack.initiateTransfer({
      amount: netAmount,
      recipientCode: recipient.recipient_code,
      reference,
      reason: 'ChessFifa wallet withdrawal'
    });
    const settledNow = transfer.status === 'success';
    await PaystackTransaction.update(
      { recipientCode: recipient.recipient_code, transferCode: transfer.transfer_code, status: settledNow ? 'success' : 'pending' },
      { where: { reference } }
    );
    // Most Paystack transfers settle asynchronously (status comes back 'pending' or
    // 'otp' here) — final confirmation arrives via the transfer.success/failed webhook.
    return {
      balance: balanceAfterDebit,
      status: settledNow ? 'success' : 'processing',
      requestedAmount: amount,
      platformFee,
      paystackFee,
      netAmount
    };
  } catch (err) {
    await refundFailedWithdrawal(reference, err.message);
    throw err;
  }
}

/** Reverses a withdrawal's debit — called either synchronously above when Paystack
 *  rejects the recipient/transfer outright, or later from the webhook when a transfer
 *  Paystack initially accepted comes back transfer.failed/transfer.reversed. A no-op if
 *  the withdrawal already resolved (success or a prior refund), so it's safe to call more
 *  than once for the same reference. */
export async function refundFailedWithdrawal(reference, reason) {
  const result = await sequelize.transaction(async t => {
    const paystackTxn = await PaystackTransaction.findOne({ where: { reference }, lock: t.LOCK.UPDATE, transaction: t });
    if (!paystackTxn || paystackTxn.status !== 'pending') return null;
    const wallet = await Wallet.findOne({ where: { userId: paystackTxn.userId }, lock: t.LOCK.UPDATE, transaction: t });
    if (!wallet) return null;
    wallet.balance = Number(wallet.balance) + Number(paystackTxn.amount);
    await wallet.save({ transaction: t });
    paystackTxn.status = 'failed';
    paystackTxn.failureReason = reason || 'Transfer failed';
    await paystackTxn.save({ transaction: t });
    await Transaction.create(
      {
        userId: paystackTxn.userId,
        type: 'withdrawal_refund',
        amount: paystackTxn.amount,
        walletBalanceAfter: wallet.balance,
        escrowBalanceAfter: (await WagerAccount.findOne({ where: { userId: paystackTxn.userId }, transaction: t })).escrowBalance
      },
      { transaction: t }
    );
    return { userId: paystackTxn.userId, balance: Number(wallet.balance) };
  });
  if (result) emitToUser(result.userId, 'wallet:balance', { balance: result.balance });
}

/** Called once a withdrawal's transfer actually clears. No balance change happens here —
 *  that was already applied up front in initializeWithdrawal — this just marks the row
 *  settled so it stops looking pending. */
export async function confirmWithdrawalSuccess(reference) {
  await PaystackTransaction.update({ status: 'success' }, { where: { reference, status: 'pending' } });
}

/** Moves `amount` from a member's Wallet into their WagerAccount escrow — called once per
 *  player when a match begins. Must run inside the caller's own transaction (challenge
 *  acceptance touches multiple rows across two players plus the new Match record, so the
 *  whole thing needs to commit or fail together) — pass that transaction in as `t`. */
export async function holdEscrow(userId, amount, { matchId, challengeId }, t) {
  const wallet = await Wallet.findOne({ where: { userId }, lock: t.LOCK.UPDATE, transaction: t });
  const wagerAccount = await WagerAccount.findOne({ where: { userId }, lock: t.LOCK.UPDATE, transaction: t });
  if (!wallet || !wagerAccount) throw new ApiError(404, 'Account not found.');
  if (Number(wallet.balance) < amount) throw new ApiError(400, 'Insufficient balance to cover this stake.');

  wallet.balance = Number(wallet.balance) - Number(amount);
  wagerAccount.escrowBalance = Number(wagerAccount.escrowBalance) + Number(amount);
  wagerAccount.lifetimeWagered = Number(wagerAccount.lifetimeWagered) + Number(amount);
  await wallet.save({ transaction: t });
  await wagerAccount.save({ transaction: t });
  await Transaction.create(
    {
      userId,
      type: 'escrow_hold',
      amount,
      walletBalanceAfter: wallet.balance,
      escrowBalanceAfter: wagerAccount.escrowBalance,
      matchId,
      challengeId
    },
    { transaction: t }
  );
}

/** Settles one player's side of a finished match: releases their held stake from escrow
 *  and credits `payout` back to their Wallet (0 for a loss, stake for a draw, stake*2 for
 *  a win). Also must run inside the caller's transaction — see match.service.js, which
 *  calls this once per player so both settle atomically together. */
export async function releaseEscrowAndPay(userId, stake, payout, outcome, matchId, t) {
  const wallet = await Wallet.findOne({ where: { userId }, lock: t.LOCK.UPDATE, transaction: t });
  const wagerAccount = await WagerAccount.findOne({ where: { userId }, lock: t.LOCK.UPDATE, transaction: t });
  if (!wallet || !wagerAccount) throw new ApiError(404, 'Account not found.');

  wagerAccount.escrowBalance = Number(wagerAccount.escrowBalance) - Number(stake);
  wallet.balance = Number(wallet.balance) + Number(payout);
  wagerAccount.matchesPlayed += 1;
  if (outcome === 'win') wagerAccount.lifetimeWon = Number(wagerAccount.lifetimeWon) + Number(payout - stake);
  if (outcome === 'loss') wagerAccount.lifetimeLost = Number(wagerAccount.lifetimeLost) + Number(stake);

  await wallet.save({ transaction: t });
  await wagerAccount.save({ transaction: t });
  await Transaction.create(
    {
      userId,
      type: payout > 0 ? 'payout' : 'escrow_release',
      amount: payout > 0 ? payout : stake,
      walletBalanceAfter: wallet.balance,
      escrowBalanceAfter: wagerAccount.escrowBalance,
      matchId
    },
    { transaction: t }
  );
}
