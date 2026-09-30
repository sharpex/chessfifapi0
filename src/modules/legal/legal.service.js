import { MIN_WITHDRAWAL_AMOUNT, MIN_NET_WITHDRAWAL, PLATFORM_FEE_RATE } from '../../utils/withdrawalFees.js';

/** Sample legal content only — not reviewed by legal counsel. A real money-wagering
 *  platform needs both of these drafted and reviewed by a licensed attorney in every
 *  jurisdiction it operates in before launch. Served from here (GET /legal/terms,
 *  GET /legal/privacy) rather than hardcoded into the frontend so there's exactly one
 *  place to update when something like the withdrawal fee structure changes, instead of
 *  needing to find and edit matching text buried in a modal component. */

const LAST_UPDATED = '2026-09-25';

const TERMS = {
  title: 'Terms & Conditions',
  updatedAt: LAST_UPDATED,
  disclaimer:
    'Sample terms for demonstration purposes only. This text is a placeholder and has not been reviewed by legal counsel. A real money-wagering platform must have these terms drafted and reviewed by a licensed attorney in every jurisdiction it operates in before launch.',
  sections: [
    {
      heading: '1. Eligibility',
      body: 'You must be at least 18 years old, or the legal age of majority in your jurisdiction, and located where real-money chess wagering is legal, to create an account or place a wager.'
    },
    {
      heading: '2. Account & Wallet',
      body: 'You are responsible for maintaining the confidentiality of your account credentials. Funds deposited into your wallet are held for the purpose of placing wagers on chess matches and may be withdrawn subject to the verification requirements and fees described below.'
    },
    {
      heading: '3. Wagering',
      body: "Stakes placed on a challenge are escrowed for the duration of the match. The winner of a match receives both players' stakes. Draws return each player's own stake. Resigning or forfeiting a match (including by disconnecting and failing to reconnect within the reconnection window, or by failing to move within the per-move time limit) counts as a loss for wagering purposes."
    },
    {
      heading: '4. Fair Play',
      body: 'Use of chess engines, external assistance, or multiple accounts to manipulate outcomes is prohibited and may result in forfeiture of funds and account termination.'
    },
    {
      heading: '5. Identity Verification',
      body: 'Before withdrawing funds, you may be required to verify your identity in accordance with applicable know-your-customer (KYC) and anti-money-laundering (AML) regulations.'
    },
    {
      heading: '6. Withdrawal Fees',
      body: `Withdrawals are subject to two deductions, both taken from the amount you request before it is sent to your bank account or M-Pesa wallet: a platform fee of ${PLATFORM_FEE_RATE * 100}% of the requested amount, and our payment processor\u2019s (Paystack) transfer fee for Kenyan payouts, currently KSh 20\u201360 per transfer depending on the amount, charged in flat bands rather than as a percentage. The minimum amount you can request to withdraw is KSh ${MIN_WITHDRAWAL_AMOUNT}, set so that even after both deductions you still receive at least KSh ${MIN_NET_WITHDRAWAL}. The exact amount you will receive, after both deductions, is shown to you before you confirm any withdrawal. These fees may change; the amount actually credited to your wallet\u2019s transaction history for a given withdrawal always reflects what was in effect at the time.`
    },
    {
      heading: '7. Risk Disclosure',
      body: 'Wagering involves financial risk. Only stake funds you can afford to lose. This platform does not guarantee winnings.'
    },
    {
      heading: '8. Changes',
      body: 'These terms may be updated from time to time; continued use of the platform after changes constitutes acceptance of the revised terms.'
    }
  ]
};

const PRIVACY = {
  title: 'Privacy Policy',
  updatedAt: LAST_UPDATED,
  disclaimer:
    'Sample privacy policy for demonstration purposes only. This text is a placeholder and has not been reviewed by legal counsel. A real money-wagering platform must have its privacy practices reviewed against applicable data-protection law (e.g. Kenya\u2019s Data Protection Act) in every jurisdiction it operates in before launch.',
  sections: [
    {
      heading: '1. Information We Collect',
      body: 'Account information (display name, email, password hash or OAuth identity); wallet and transaction records (deposits, withdrawals, stakes, match outcomes); gameplay data (moves, chat messages sent through the platform); and basic technical data (device/browser type, IP address) needed to operate and secure the service.'
    },
    {
      heading: '2. How We Use Your Information',
      body: 'To operate your account and wallet, process deposits and withdrawals, match you with opponents, enforce fair play and these Terms, communicate service-related notices (including push notifications you\u2019ve enabled), and comply with applicable KYC/AML obligations.'
    },
    {
      heading: '3. Payment Processing',
      body: `Deposits and withdrawals are processed by Paystack, a third-party payment processor. We do not store your full card or bank account credentials ourselves. Every withdrawal is subject to a ${PLATFORM_FEE_RATE * 100}% platform fee and Paystack\u2019s own Kenya transfer fee (see the Terms & Conditions); the resulting breakdown \u2014 amount requested, platform fee, Paystack fee, and net amount sent \u2014 is recorded in your transaction history and is visible to you at any time.`
    },
    {
      heading: '4. Data Retention',
      body: 'Account, wallet, and transaction records are retained for as long as your account is active and for a reasonable period afterward, as needed to satisfy financial record-keeping, dispute-resolution, and legal obligations.'
    },
    {
      heading: '5. Your Rights',
      body: 'Depending on your jurisdiction, you may have rights to access, correct, or request deletion of your personal data, subject to our need to retain financial transaction records as described above. Contact us using the details below to make a request.'
    },
    {
      heading: '6. Cookies & Local Storage',
      body: 'The app uses browser storage (such as local storage) to keep you signed in and remember basic preferences. It does not use third-party advertising trackers.'
    },
    {
      heading: '7. Security',
      body: 'We use industry-standard measures (password hashing, encrypted connections, server-side validation of every balance-changing action) to protect your account and funds. No system is perfectly secure, and you\u2019re responsible for keeping your own credentials confidential.'
    },
    {
      heading: '8. Children\u2019s Privacy',
      body: 'This platform is not directed at, and is not available to, anyone under 18 \u2014 see the Eligibility clause in the Terms & Conditions. We do not knowingly collect data from minors.'
    },
    {
      heading: '9. Changes to This Policy',
      body: 'This policy may be updated from time to time; continued use of the platform after changes constitutes acceptance of the revised policy.'
    },
    {
      heading: '10. Contact Us',
      body: 'Questions about this policy or your data can be directed to the platform\u2019s support contact.'
    }
  ]
};

export function getTerms() {
  return TERMS;
}

export function getPrivacyPolicy() {
  return PRIVACY;
}
