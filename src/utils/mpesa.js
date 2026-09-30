import crypto from 'node:crypto';
import fs from 'node:fs';
import { env } from '../config/env.js';
import { ApiError } from './ApiError.js';

/** Thin client for Safaricom's Daraja API — the M-Pesa Paybill rail. Completely separate
 *  from utils/paystack.js; nothing here knows Paystack exists. Same overall shape though:
 *  a small request helper plus one function per API call the app actually makes. */

const BASE_URL = env.mpesa.environment === 'production'
  ? 'https://api.safaricom.co.ke'
  : 'https://sandbox.safaricom.co.ke';

/* ---------------- Configuration gates ---------------- */

/** Deposits (STK Push) need the OAuth app, the Paybill + its Lipa Na M-Pesa passkey, and
 *  the callback secret. Withdrawals (B2C) additionally need the initiator and the
 *  certificate, but NOT the passkey. Checked per-feature so a deployment that's only set
 *  up one direction still gets that direction. */
export function isDepositConfigured() {
  const m = env.mpesa;
  return Boolean(m.consumerKey && m.consumerSecret && m.shortcode && m.passkey && m.callbackSecret);
}

export function isWithdrawalConfigured() {
  const m = env.mpesa;
  return Boolean(m.consumerKey && m.consumerSecret && m.shortcode && m.initiatorName && m.initiatorPassword && m.certPath && m.callbackSecret);
}

export function assertDepositConfigured() {
  if (!isDepositConfigured()) throw new ApiError(503, "M-Pesa deposits aren't set up on this server yet.");
}

export function assertWithdrawalConfigured() {
  if (!isWithdrawalConfigured()) throw new ApiError(503, "M-Pesa withdrawals aren't set up on this server yet.");
}

/* ---------------- Helpers ---------------- */

/** Any common way a Kenyan Safaricom number gets typed -> 2547XXXXXXXX / 2541XXXXXXXX, the
 *  only format Daraja accepts. Null if it isn't recognisably one (Safaricom lines start
 *  07 or 01; anything else, including other networks' ranges, can't receive M-Pesa). */
export function normalizeMsisdn(input) {
  if (!input) return null;
  let s = String(input).replace(/[\s\-()]/g, '');
  if (s.startsWith('+')) s = s.slice(1);
  if (/^0[17]\d{8}$/.test(s)) s = '254' + s.slice(1);
  else if (/^[17]\d{8}$/.test(s)) s = '254' + s;
  return /^254[17]\d{8}$/.test(s) ? s : null;
}

/** Daraja timestamps are YYYYMMDDHHmmss in Nairobi time (UTC+3, no DST), and the STK
 *  password is derived from the exact string, so the two must always be built together. */
function timestamp() {
  const d = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const p = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

function stkPassword(ts) {
  return Buffer.from(`${env.mpesa.shortcode}${env.mpesa.passkey}${ts}`).toString('base64');
}

/** URLs handed to Safaricom for async results. Two deliberate choices:
 *   - The path contains an unguessable secret, because unlike Paystack's HMAC-signed
 *     webhooks, Daraja callbacks carry no signature — knowing the URL is the only proof a
 *     request came from Safaricom (see modules/mpesa/mpesa.controller.js).
 *   - The prefix is /pay-hooks, NOT /mpesa: Safaricom has been known to reject callback
 *     URLs containing words like "mpesa", "safaricom", "exec", "cmd", "sql" or "query",
 *     so keep those out of the path (and out of MPESA_CALLBACK_SECRET — use hex). */
export function callbackUrl(kind) {
  return `${env.appBaseUrl}/pay-hooks/${env.mpesa.callbackSecret}/${kind}`;
}

/* ---------------- OAuth ---------------- */

let cachedToken = null; // { value, expiresAt }

/** Failures here mean nothing was ever submitted for the money-moving call that needed
 *  the token, so they're flagged definitive (safe to treat as "definitely didn't happen"
 *  and refund) — see the same flag on darajaPost's rejections below. */
async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.value;

  const basic = Buffer.from(`${env.mpesa.consumerKey}:${env.mpesa.consumerSecret}`).toString('base64');
  let res;
  try {
    res = await fetch(`${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: { Authorization: `Basic ${basic}` },
      signal: AbortSignal.timeout(20_000)
    });
  } catch {
    const err = new ApiError(502, 'Could not reach M-Pesa — try again shortly.');
    err.definitive = true;
    throw err;
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.access_token) {
    const err = new ApiError(502, 'M-Pesa authentication failed — check the Daraja consumer key/secret.');
    err.definitive = true;
    throw err;
  }
  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + Number(data.expires_in || 3599) * 1000
  };
  return cachedToken.value;
}

/* ---------------- Request helper ---------------- */

/** Every Daraja POST goes through here. The distinction that matters for money-OUT calls
 *  is whether a failure is DEFINITIVE — Daraja explicitly answered "no" (a JSON error body
 *  with an errorCode, or a non-zero ResponseCode) so the request definitely wasn't
 *  accepted — versus AMBIGUOUS — the connection died or timed out, so the request may or
 *  may not have reached Safaricom. err.definitive carries that; the withdrawal flow only
 *  auto-refunds on definitive failures, because refunding an ambiguous one risks paying
 *  the member twice (the refund AND a payout that actually went through). */
async function darajaPost(path, body) {
  const token = await getAccessToken();
  let res;
  try {
    res = await fetch(BASE_URL + path, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000)
    });
  } catch {
    const err = new ApiError(502, 'Could not reach M-Pesa — try again shortly.');
    err.definitive = false;
    throw err;
  }
  const data = await res.json().catch(() => null);

  if (!res.ok || (data && data.errorCode)) {
    const err = new ApiError(502, data?.errorMessage || `M-Pesa request failed (${res.status}).`);
    err.darajaErrorCode = data?.errorCode || null;
    err.definitive = Boolean(data?.errorCode);
    throw err;
  }
  if (!data) {
    const err = new ApiError(502, 'M-Pesa returned an unreadable response.');
    err.definitive = false;
    throw err;
  }
  return data;
}

function rejectionFrom(data) {
  const err = new ApiError(502, data.ResponseDescription || data.errorMessage || 'M-Pesa rejected the request.');
  err.definitive = true;
  return err;
}

/* ---------------- Deposits: STK Push ---------------- */

/** Pops the M-Pesa PIN prompt on the customer's phone. Returns as soon as Safaricom has
 *  ACCEPTED the request — whether the customer then pays is reported later via the
 *  callback (and reconcilable via queryStkStatus). amount must be a whole number of
 *  shillings; phoneNumber must already be normalized. */
export async function initiateStkPush({ phoneNumber, amount }) {
  const ts = timestamp();
  const data = await darajaPost('/mpesa/stkpush/v1/processrequest', {
    BusinessShortCode: Number(env.mpesa.shortcode),
    Password: stkPassword(ts),
    Timestamp: ts,
    TransactionType: 'CustomerPayBillOnline',
    Amount: amount,
    PartyA: Number(phoneNumber),
    PartyB: Number(env.mpesa.shortcode),
    PhoneNumber: Number(phoneNumber),
    CallBackURL: callbackUrl('stk'),
    AccountReference: 'ChessFifa',
    TransactionDesc: 'Wallet top-up'
  });
  if (String(data.ResponseCode) !== '0') throw rejectionFrom(data);
  return {
    merchantRequestId: data.MerchantRequestID,
    checkoutRequestId: data.CheckoutRequestID,
    customerMessage: data.CustomerMessage
  };
}

/** Asks Safaricom directly what happened to an STK Push. Returns
 *  { state: 'success' | 'failed' | 'pending', resultCode, resultDesc }. This is the
 *  "never trust the callback alone" check — used to confirm a success callback before
 *  crediting a wallet, and to settle deposits whose callback never arrived at all.
 *  Daraja reports "still being processed" as an error (500.001.1001) rather than a status,
 *  which is folded into 'pending' here; any OTHER error propagates so the caller leaves
 *  the deposit pending and tries again later instead of guessing. */
export async function queryStkStatus(checkoutRequestId) {
  const ts = timestamp();
  let data;
  try {
    data = await darajaPost('/mpesa/stkpushquery/v1/query', {
      BusinessShortCode: Number(env.mpesa.shortcode),
      Password: stkPassword(ts),
      Timestamp: ts,
      CheckoutRequestID: checkoutRequestId
    });
  } catch (err) {
    if (err.darajaErrorCode === '500.001.1001') return { state: 'pending' };
    throw err;
  }
  if (data.ResultCode === undefined || data.ResultCode === null || data.ResultCode === '') return { state: 'pending' };
  const resultCode = String(data.ResultCode);
  return {
    state: resultCode === '0' ? 'success' : 'failed',
    resultCode,
    resultDesc: data.ResultDesc || null
  };
}

/* ---------------- Withdrawals: B2C ---------------- */

let cachedCert = null;

/** The B2C SecurityCredential: the initiator password, RSA-encrypted (PKCS#1 v1.5 — what
 *  Daraja requires, despite that padding's age) with Safaricom's public certificate and
 *  base64'd. Sandbox and production use different certificates, so MPESA_CERT_PATH has to
 *  match MPESA_ENV. Failures here happen before anything is sent, hence definitive. */
export function getSecurityCredential() {
  try {
    if (!cachedCert) cachedCert = fs.readFileSync(env.mpesa.certPath, 'utf8');
    return crypto
      .publicEncrypt({ key: cachedCert, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(env.mpesa.initiatorPassword))
      .toString('base64');
  } catch (e) {
    console.error('[mpesa] could not build the B2C security credential:', e.message);
    const err = new ApiError(503, "M-Pesa withdrawals aren't set up correctly on this server yet.");
    err.definitive = true;
    throw err;
  }
}

/** Sends money from the Paybill to a phone. originatorConversationId is OUR unique id for
 *  this payout (sent on Daraja's v3 endpoint, which accepts it), so the row can be saved
 *  BEFORE this call and the result callback always finds it — no window where a fast
 *  callback races ahead of us learning the id. It doubles as an idempotency key: Daraja
 *  will not process the same OriginatorConversationID twice. amount must be a whole number
 *  of shillings and is what the member actually receives (fees are already deducted by the
 *  caller). Accepted != paid: the final outcome arrives at the result callback. */
export async function initiateB2C({ originatorConversationId, phoneNumber, amount, remarks = 'ChessFifa withdrawal' }) {
  const securityCredential = getSecurityCredential();
  const data = await darajaPost('/mpesa/b2c/v3/paymentrequest', {
    OriginatorConversationID: originatorConversationId,
    InitiatorName: env.mpesa.initiatorName,
    SecurityCredential: securityCredential,
    CommandID: 'BusinessPayment',
    Amount: amount,
    PartyA: Number(env.mpesa.shortcode),
    PartyB: Number(phoneNumber),
    Remarks: remarks,
    QueueTimeOutURL: callbackUrl('b2c-timeout'),
    ResultURL: callbackUrl('b2c-result')
  });
  if (String(data.ResponseCode) !== '0') throw rejectionFrom(data);
  return {
    conversationId: data.ConversationID,
    originatorConversationId: data.OriginatorConversationID || originatorConversationId
  };
}
