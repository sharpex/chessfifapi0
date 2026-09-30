import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { ApiError } from './ApiError.js';

const BASE_URL = 'https://api.paystack.co';

/** Every Paystack endpoint uses the same shape: { status: boolean, message, data }.
 *  `status: false` (or a non-2xx) means the call itself failed — that's always our fault
 *  (bad params, misconfigured account) or Paystack's, never the wallet holder's, so it
 *  surfaces as a 502 rather than something worth showing verbatim to a user. */
async function paystackRequest(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(BASE_URL + path, {
      method,
      headers: {
        Authorization: `Bearer ${env.paystack.secretKey}`,
        'Content-Type': 'application/json'
      },
      body: body ? JSON.stringify(body) : undefined
    });
  } catch (err) {
    throw new ApiError(502, 'Could not reach Paystack — try again shortly.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.status === false) {
    throw new ApiError(502, (data && data.message) || 'Paystack request failed.');
  }
  return data.data;
}

/** Dollars-and-cents-style decimal amount -> the integer subunit count Paystack's API
 *  actually wants (kobo/cents/etc, depending on env.paystack.currency). Always round —
 *  floating point on a *100 can land on e.g. 1999.9999999998. */
function toSubunit(amount) {
  return Math.round(Number(amount) * 100);
}

/** The reverse of toSubunit — Paystack amounts come back as integer subunits too, so
 *  anything read from a webhook/verify response needs converting back before it's
 *  compared against or added to a wallet balance stored in whole currency units. */
function fromSubunit(subunitAmount) {
  return Number(subunitAmount) / 100;
}

export const paystack = {
  toSubunit,
  fromSubunit,

  /** Starts a hosted-checkout (or Inline-popup, from the same reference) deposit.
   *  `reference` must be unique per attempt — the caller is responsible for generating
   *  one and persisting it before calling this, so the payment can be looked back up
   *  regardless of which of {webhook, verify-on-return} resolves it first. */
  initializeTransaction({ email, amount, reference, callbackUrl, metadata }) {
    return paystackRequest('/transaction/initialize', {
      method: 'POST',
      body: {
        email,
        amount: toSubunit(amount),
        currency: env.paystack.currency,
        reference,
        callback_url: callbackUrl,
        metadata
      }
    });
  },

  /** Re-fetches a transaction's true status directly from Paystack — never trust a
   *  webhook payload or a client's "it succeeded" claim without this, since either could
   *  be spoofed or stale. */
  verifyTransaction(reference) {
    return paystackRequest(`/transaction/verify/${encodeURIComponent(reference)}`);
  },

  /** Registers a payout destination. Required once per withdrawal before a transfer can
   *  be sent to it — Paystack doesn't accept raw bank details on /transfer itself.
   *  `type: 'nuban'` (Nigerian bank accounts, 10-digit account number + bank code) is the
   *  common case; if the Paystack account this backend talks to is registered in a
   *  different country, this — and the account-number format the frontend collects —
   *  needs to match whatever recipient type that country uses instead. */
  createTransferRecipient({ name, accountNumber, bankCode }) {
    return paystackRequest('/transferrecipient', {
      method: 'POST',
      body: {
        type: 'nuban',
        name,
        account_number: accountNumber,
        bank_code: bankCode,
        currency: env.paystack.currency
      }
    });
  },

  /** Pays a previously-created recipient out of the Paystack balance. `reference` should
   *  be unique per withdrawal attempt, same reasoning as initializeTransaction. */
  initiateTransfer({ amount, recipientCode, reference, reason }) {
    return paystackRequest('/transfer', {
      method: 'POST',
      body: {
        source: 'balance',
        amount: toSubunit(amount),
        recipient: recipientCode,
        reference,
        reason
      }
    });
  },

  /** Bank list for the withdrawal form's dropdown, so a person picks a bank by name
   *  instead of having to already know its Paystack bank_code. */
  listBanks() {
    return paystackRequest(`/bank?currency=${env.paystack.currency}`);
  },

  /** Confirms an account number actually belongs to a real account (and returns the
   *  holder's name) before a withdrawal is submitted, catching typos before money moves. */
  resolveAccountNumber({ accountNumber, bankCode }) {
    return paystackRequest(`/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`);
  },

  /** Paystack signs every webhook body with HMAC-SHA512 using the same secret key, sent
   *  in the `x-paystack-signature` header — this is what stops anyone who finds the
   *  webhook URL from POSTing fake "payment succeeded" events. `rawBody` must be the
   *  exact bytes Paystack sent (see app.js's express.json verify hook) — re-serializing
   *  the parsed JSON before hashing would produce a different signature and reject every
   *  legitimate webhook too. */
  verifyWebhookSignature(rawBody, signatureHeader) {
    if (!signatureHeader || !rawBody) return false;
    const expected = crypto.createHmac('sha512', env.paystack.secretKey).update(rawBody).digest('hex');
    // Constant-time compare — a naive === leaks timing information about how many
    // leading bytes matched, which is exactly the kind of oracle a signature check exists
    // to not have.
    const expectedBuf = Buffer.from(expected, 'hex');
    const givenBuf = Buffer.from(signatureHeader, 'hex');
    if (expectedBuf.length !== givenBuf.length) return false;
    return crypto.timingSafeEqual(expectedBuf, givenBuf);
  }
};
