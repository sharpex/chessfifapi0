import { env } from '../config/env.js';

/** Fee breakdown for an M-Pesa (Paybill B2C) withdrawal. Deliberately its own file with
 *  its own constants rather than importing from withdrawalFees.js — the M-Pesa and
 *  Paystack rails are separate features, so changing one's rate or floor shouldn't
 *  silently change the other's, even though both happen to be 15% / KSh 100 today.
 *
 *  Two deductions, both taken from the amount the member requests before anything is
 *  sent, same shape as the Paystack flow:
 *    1. The platform fee — MPESA_PLATFORM_FEE_PERCENT of the requested amount.
 *    2. Safaricom's B2C transaction charge — read from MPESA_B2C_FEE_BANDS. Safaricom
 *       charges this to the BUSINESS's account when it sends money out, not to the
 *       recipient, so (like Paystack's transfer fee) it's deducted here so the member
 *       bears it instead of the platform quietly absorbing it.
 *
 *  Everything is whole shillings on purpose: M-Pesa B2C amounts are integers, so the
 *  platform fee is rounded UP to the next whole shilling and the requested amount must
 *  itself be a whole number (enforced by the caller). That keeps netAmount an exact
 *  integer with no hidden sub-shilling remainder the platform silently keeps. */

export const MPESA_PLATFORM_FEE_PERCENT = 15;
export const MPESA_PLATFORM_FEE_RATE = MPESA_PLATFORM_FEE_PERCENT / 100;

/** The member is guaranteed to receive at least this much after both deductions — the
 *  floor MPESA minimum-withdrawal below is solved against. */
export const MPESA_MIN_NET_WITHDRAWAL = 100;

/** Parses "1500:25,20000:45,*:65" into [{ max: 1500, fee: 25 }, { max: 20000, fee: 45 },
 *  { max: Infinity, fee: 65 }]. Returns [] (meaning "not configured") for an empty or
 *  malformed value rather than throwing at import time — a typo here should disable M-Pesa
 *  withdrawals loudly (see isMpesaFeeScheduleConfigured), not crash the whole server. The
 *  catch-all "*" band must exist and come last so every possible amount maps to a fee. */
function parseFeeBands(raw) {
  if (!raw || !raw.trim()) return [];
  const bands = [];
  for (const part of raw.split(',')) {
    const [maxRaw, feeRaw] = part.split(':').map(s => s.trim());
    const fee = Number(feeRaw);
    const max = maxRaw === '*' ? Infinity : Number(maxRaw);
    if (!Number.isFinite(fee) || fee < 0 || Number.isNaN(max) || max <= 0) {
      console.warn(`[mpesa] MPESA_B2C_FEE_BANDS has a malformed entry ("${part}") — M-Pesa withdrawals disabled until fixed.`);
      return [];
    }
    bands.push({ max, fee });
  }
  const sorted = bands.every((b, i) => i === 0 || b.max > bands[i - 1].max);
  const endsWithCatchAll = bands.length > 0 && bands[bands.length - 1].max === Infinity;
  if (!sorted || !endsWithCatchAll) {
    console.warn('[mpesa] MPESA_B2C_FEE_BANDS must be in ascending order and end with a "*" band — M-Pesa withdrawals disabled until fixed.');
    return [];
  }
  return bands;
}

export const MPESA_B2C_FEE_BANDS = parseFeeBands(env.mpesa.b2cFeeBands);

export function isMpesaFeeScheduleConfigured() {
  return MPESA_B2C_FEE_BANDS.length > 0;
}

/** Integer math throughout (percent as a whole number, ceil of amount*percent/100) — a
 *  float like 0.15*140 can land a hair above an exact integer and make Math.ceil round up
 *  a whole extra shilling, which is precisely the kind of off-by-one in a fee the member
 *  would notice and the platform couldn't explain. */
export function calculateMpesaWithdrawalFees(requestedAmount) {
  const amount = Math.round(Number(requestedAmount));
  const platformFee = Math.ceil((amount * MPESA_PLATFORM_FEE_PERCENT) / 100);
  const band = MPESA_B2C_FEE_BANDS.find(b => amount - platformFee <= b.max) || MPESA_B2C_FEE_BANDS[MPESA_B2C_FEE_BANDS.length - 1];
  const mpesaFee = band ? band.fee : 0;
  const netAmount = amount - platformFee - mpesaFee;
  return { requestedAmount: amount, platformFee, mpesaFee, netAmount };
}

let cachedMinimum;

/** Smallest whole-shilling request that still nets the member MPESA_MIN_NET_WITHDRAWAL
 *  after both fees. Solved by walking up rather than closed-form — the fee bands are a step
 *  function, so an exact inverse is more trouble than a bounded loop that runs once.
 *  Null when the fee schedule isn't configured (withdrawals are disabled then anyway). */
export function getMinimumMpesaWithdrawalAmount() {
  if (cachedMinimum !== undefined) return cachedMinimum;
  if (!isMpesaFeeScheduleConfigured()) {
    cachedMinimum = null;
    return cachedMinimum;
  }
  let candidate = MPESA_MIN_NET_WITHDRAWAL;
  const ceiling = 1_000_000; // guard against a pathological fee schedule looping forever
  while (candidate < ceiling && calculateMpesaWithdrawalFees(candidate).netAmount < MPESA_MIN_NET_WITHDRAWAL) candidate += 1;
  cachedMinimum = candidate < ceiling ? candidate : null;
  return cachedMinimum;
}
