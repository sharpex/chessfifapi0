import 'dotenv/config';

function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 4000),

  db: {
    host: required('DB_HOST', '127.0.0.1'),
    port: Number(process.env.DB_PORT || 3306),
    name: required('DB_NAME'),
    user: required('DB_USER'),
    password: process.env.DB_PASSWORD || ''
  },

  jwt: {
    secret: required('JWT_SECRET'),
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  },

  corsOrigin: process.env.CORS_ORIGIN || '*',

  demoSignupBonus: Number(process.env.DEMO_SIGNUP_BONUS || 0),

  // Base URL of this API itself (not the frontend) — used to build the callback_url
  // Paystack redirects back to after a hosted checkout, and any other absolute links the
  // backend needs to hand out.
  appBaseUrl: process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 4000}`,

  // Where the SPA itself is served — used to build the password-reset link emailed to
  // members (see utils/mailer.js). The app has no client-side router (see
  // useResetPasswordLink.js on the frontend), so this just needs to be the app's own
  // origin; the reset token rides along as a query param the app reads on load.
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',

  paystack: {
    secretKey: required('PAYSTACK_SECRET_KEY'),
    publicKey: required('PAYSTACK_PUBLIC_KEY'),
    // Whatever currency the Paystack merchant account is actually registered in — this
    // must match, or transaction/initialize and transfer calls are rejected. Wallet
    // balances/stakes are stored and displayed as plain decimal amounts in this currency;
    // Paystack's API wants amounts in the currency's smallest unit (e.g. cents for KES),
    // which paystack.js converts at the boundary. Defaults to KES — see .env.example —
    // since the site itself runs in Kenyan Shillings (see utils/format.js on the frontend).
    currency: process.env.PAYSTACK_CURRENCY || 'KES'
  },

  oauth: {
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    facebookAppId: process.env.FACEBOOK_APP_ID || '',
    facebookAppSecret: process.env.FACEBOOK_APP_SECRET || ''
  },

  // Web Push (VAPID) — optional. Unlike Paystack, push notifications are a nice-to-have,
  // not core money infrastructure, so an unconfigured deployment shouldn't fail to boot
  // over it: utils/webPush.js checks these at call time and no-ops (logging once) if
  // they're missing, rather than the server refusing to start. Generate a pair with
  // `npx web-push generate-vapid-keys` — see .env.example.
  vapid: {
    publicKey: process.env.VAPID_PUBLIC_KEY || '',
    privateKey: process.env.VAPID_PRIVATE_KEY || '',
    subject: process.env.VAPID_SUBJECT || 'mailto:support@example.com'
  },

  // SMTP (password-reset emails) — optional, same reasoning as vapid above: a mailer is
  // nice-to-have infrastructure, not core money handling, so an unconfigured deployment
  // shouldn't fail to boot over it. utils/mailer.js checks these at call time and no-ops
  // (logging what would have been sent) rather than the server refusing to start. Works
  // with any standard SMTP provider (Gmail app password, SendGrid, Mailgun, etc.) — just
  // needs a host/port and the account's own user/pass, per .env.example.
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT || 587),
    // true only for port 465 (implicit TLS) by convention — 587/25 use STARTTLS instead,
    // which nodemailer negotiates itself when this is false.
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'ChessFifa <no-reply@chessfifa.example>'
  },

  // Safaricom Daraja (M-Pesa Paybill) — a completely separate payment rail from the
  // Paystack block above; nothing here is shared with it. Optional for the same reason as
  // vapid/smtp: an unconfigured deployment still boots and Paystack still works, the
  // /mpesa endpoints just answer 503 until this is filled in (see utils/mpesa.js).
  mpesa: {
    environment: process.env.MPESA_ENV === 'production' ? 'production' : 'sandbox',
    consumerKey: process.env.MPESA_CONSUMER_KEY || '',
    consumerSecret: process.env.MPESA_CONSUMER_SECRET || '',
    // The Paybill number — used as BusinessShortCode/PartyB for deposits (STK Push) and
    // PartyA for withdrawals (B2C). A single Paybill can do both; a Buy-Goods Till cannot.
    shortcode: process.env.MPESA_SHORTCODE || '',
    passkey: process.env.MPESA_PASSKEY || '', // Lipa Na M-Pesa Online passkey (STK Push)
    initiatorName: process.env.MPESA_INITIATOR_NAME || '',
    initiatorPassword: process.env.MPESA_INITIATOR_PASSWORD || '',
    // Safaricom's public X.509 certificate (sandbox and production ship different ones) —
    // the initiator password gets RSA-encrypted with it into the B2C SecurityCredential.
    certPath: process.env.MPESA_CERT_PATH || '',
    // Unguessable path segment baked into the callback URLs we hand Safaricom, since
    // Daraja callbacks aren't signed the way Paystack's webhooks are — see
    // modules/mpesa/mpesa.controller.js. Use hex/alphanumerics only.
    callbackSecret: process.env.MPESA_CALLBACK_SECRET || '',
    maxTransaction: Number(process.env.MPESA_MAX_TRANSACTION || 150000),
    // Safaricom B2C charges are negotiated per business — there's no single public tariff to
    // hardcode the way Paystack publishes its Kenya transfer bands — so this is entirely
    // operator-supplied, with deliberately NO default: M-Pesa withdrawals stay disabled
    // until it's set rather than silently guessing a number that ends up over- or
    // under-charging every payout. Format: "<maxAmount>:<fee>,...,*:<fee>" — e.g.
    // "1500:25,20000:45,*:65" means up to KSh 1,500 costs 25, up to 20,000 costs 45,
    // anything above costs 65. "*:30" alone is a flat 30. See utils/mpesaFees.js.
    b2cFeeBands: process.env.MPESA_B2C_FEE_BANDS || ''
  }
};
