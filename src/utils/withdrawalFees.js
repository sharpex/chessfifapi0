/** Platform + Paystack fee breakdown for a Kenyan-Shilling withdrawal.
 *
 *  PLATFORM_FEE_RATE is this app's own cut, taken first, off the amount the member
 *  actually asked to withdraw.
 *
 *  PAYSTACK_TRANSFER_FEE_BANDS mirrors Paystack's published Kenya (M-Pesa) transfer
 *  pricing — https://support.paystack.com/en/articles/2130370, checked September 2026 —
 *  a flat fee per successful transfer based on the amount actually being sent, NOT a
 *  percentage:
 *    KES 10    – KES 1,500   -> KES 20
 *    KES 1,501 – KES 20,000  -> KES 40
 *    KES 20,001 and above    -> KES 60
 *  In Paystack's own system this fee is deducted from OUR merchant balance, not the
 *  recipient — a Transfer API call for KES 1,000 lands exactly KES 1,000 in the member's
 *  account, with the KES 20 charged to us separately. To have the member bear that cost
 *  (this platform's withdrawals are priced net of both fees, not on top of them) rather
 *  than the platform silently swallowing it, we deduct it ourselves before ever calling
 *  Paystack, so the transfer amount we actually request is already net of it.
 *
 *  This pricing table is Paystack's to change at any time — re-check the URL above before
 *  relying on this for anything beyond a demo/staging deployment. */

export const PLATFORM_FEE_RATE = 0.15;

const PAYSTACK_TRANSFER_FEE_BANDS = [
  { max: 1500, fee: 20 },
  { max: 20000, fee: 40 },
  { max: Infinity, fee: 60 }
];

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** { requestedAmount, platformFee, paystackFee, netAmount }. netAmount is what's actually
 *  requested from Paystack's Transfer API — it can come back <= 0 for a small enough
 *  requested amount, which the caller should treat as "reject this withdrawal", not send
 *  a zero/negative transfer.
 *
 *  The Paystack fee band is chosen by the amount AFTER the platform fee is already taken
 *  out, since that's the number that actually reaches Paystack's Transfer API and
 *  determines their real-world fee. This is a single pass, not an iterative fixed-point
 *  solve — in a vanishingly rare case the fee itself could nudge the post-platform-fee
 *  amount just across a band boundary the other way, but these bands are wide enough
 *  relative to the fees involved (a KES 20–60 difference) that chasing that exactly isn't
 *  worth the complexity here. */
export function calculateWithdrawalFees(requestedAmount) {
  const platformFee = round2(requestedAmount * PLATFORM_FEE_RATE);
  const afterPlatformFee = round2(requestedAmount - platformFee);
  const band = PAYSTACK_TRANSFER_FEE_BANDS.find(b => afterPlatformFee <= b.max) || PAYSTACK_TRANSFER_FEE_BANDS[PAYSTACK_TRANSFER_FEE_BANDS.length - 1];
  const paystackFee = band.fee;
  const netAmount = round2(afterPlatformFee - paystackFee);
  return { requestedAmount: round2(requestedAmount), platformFee, paystackFee, netAmount };
}

/** The smallest amount a member can actually request to withdraw, enforced in
 *  initializeWithdrawal below. Chosen so the member is always guaranteed to net at least
 *  MIN_NET_WITHDRAWAL after both fees — NOT simply "MIN_NET_WITHDRAWAL plus the fees on
 *  MIN_NET_WITHDRAWAL itself" (100 + 10 + 20 = 130 might look right, but the platform fee
 *  is a percentage of the actual withdrawal amount, not of the 100 baseline — withdrawing
 *  exactly 130 only nets KSh 97, short of the 100 floor). Computed by walking up from an
 *  algebraic estimate to the first whole shilling where calculateWithdrawalFees' real
 *  netAmount actually clears the floor, so this self-corrects if PLATFORM_FEE_RATE or the
 *  fee bands above ever change, rather than needing a hand-recalculated constant. */
export const MIN_NET_WITHDRAWAL = 100;

function computeMinimumWithdrawalAmount() {
  const lowestBandFee = PAYSTACK_TRANSFER_FEE_BANDS[0].fee;
  let estimate = Math.ceil((MIN_NET_WITHDRAWAL + lowestBandFee) / (1 - PLATFORM_FEE_RATE));
  while (calculateWithdrawalFees(estimate).netAmount < MIN_NET_WITHDRAWAL) estimate += 1;
  return estimate;
}

export const MIN_WITHDRAWAL_AMOUNT = computeMinimumWithdrawalAmount();
