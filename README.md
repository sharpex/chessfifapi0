# ChessFifa API

Express + Socket.IO + Sequelize (MySQL) backend for the ChessFifa frontend — matches
every REST endpoint and socket event the frontend's `api/` and `socket/` modules call.

## Integration tests

`tests/` has two scripts that exercise the real server end-to-end (auth, wallet, socket
auth, presence, real-time challenge/match events, and the disconnect-forfeit timer) — not
mocks, actual HTTP + WebSocket calls against a running instance:

```bash
npm run db:seed        # these tests sign in as the seeded demo accounts
npm run dev &           # server needs to already be running
npm run test:integration
```

## Setup

```bash
cp .env.example .env        # then edit DB credentials / JWT secret for your machine
npm install
npm run db:migrate           # creates/updates all tables
npm run db:seed              # optional — a handful of demo accounts, see below
npm run dev                  # starts on PORT (default 4000), auto-restarts on change
```

Requires a running MySQL 8 instance matching whatever's in `.env`.

Seeded demo accounts (`npm run db:seed`) — useful for manually testing a challenge
between two real accounts without signing up twice:

| Email | Password |
|---|---|
| cedarknight@example.com | password123 |
| rookmother@example.com | password123 |
| brasspawn@example.com | password123 |
| mahoganyqueen@example.com | password123 |
| feltandfire@example.com | password123 |

Note: seeding a user does **not** make them show up in the lobby — `GET /lobby/players`
only lists members with a live socket connection (see "Design decisions" below). Sign in
as a seeded user in a second browser/tab to see them appear.

## Architecture

```
src/
  config/        env loading, Sequelize connection
  models/        User, Wallet, WagerAccount, Challenge, Match, MatchMove, Transaction
  modules/       one folder per domain — auth, wallet, lobby, challenges, matches, ai
    <name>/
      <name>.routes.js       Express router
      <name>.controller.js   thin — pulls req data, calls the service, shapes the response
      <name>.service.js      all the actual business logic and DB access
      <name>.validation.js   express-validator chains (where applicable)
  sockets/       Socket.IO bootstrap, JWT handshake auth, per-feature event handlers,
                 presence tracking, the connection-loss forfeit timer
  middleware/    JWT auth, express-validator error collection, global error handler
  utils/         JWT signing, password hashing, ApiError, asyncHandler
  chess/         chess.js wrapper for server-side move validation + the AI engine
    (both are direct ports of the frontend's own chess logic — same chess.js version,
    same minimax engine — so a difficulty level plays identically whichever side answers)
  scripts/       migrate.js, seed.js
```

Routes/controllers/services are deliberately thin-controller/fat-service: controllers
only translate HTTP <-> service calls, so the same business logic (e.g. `acceptChallenge`)
is trivially reusable from a socket handler or a future admin script without going through
Express at all.

## Wallet + Wager Account, per member

Every member gets **two** accounts, created together at signup:

- **Wallet** — spendable balance. Deposits and withdrawals happen here.
- **WagerAccount** — escrow + lifetime stats (`escrowBalance`, `lifetimeWagered`,
  `lifetimeWon`, `lifetimeLost`, `matchesPlayed`). Never touched by deposit/withdraw.

When a challenge is accepted, each player's stake moves **out of their Wallet and into
their WagerAccount's escrow** (`wallet.service.js#holdEscrow`) — not deducted and
forgotten, actually held. When the match ends, `releaseEscrowAndPay` moves it back out
of escrow: winner gets both stakes into their Wallet, loser gets nothing back, a draw
returns each their own stake. Every one of these movements also writes an immutable
`Transaction` row (`type`, `amount`, wallet/escrow balance *after* the change, and which
match/challenge it was for) — a full audit trail independent of the current balances,
so "why is my balance what it is" is always answerable from the ledger.

All of this runs inside Sequelize transactions with row-level locks (`SELECT ... FOR
UPDATE`) on every wallet/wager-account row touched — two concurrent requests against the
same balance can't race each other into an inconsistent state.

## Server-authoritative chess

The server never trusts a client's claim about move legality or match outcome:

- **Every move** (`POST /matches/:id/moves`, or `match:move` over the socket) is replayed
  against the match's own stored FEN through a real chess.js instance and rejected if
  illegal, out of turn, or from a non-participant.
- **Checkmate/draw is detected server-side** the instant a move produces it — that's what
  actually triggers settlement, not a client telling the server "I won."
- **`POST /matches/:id/result`** (the frontend's generic "here's how it ended" call) only
  trusts a self-reported **loss or draw** — a self-reported win is rejected outright,
  since only server-detected checkmate can produce one. A self-reported loss is safe to
  trust from either side (a resignation), since it can only cost the reporter money, never
  gain them any.

## Socket.IO

Auth happens once, at the handshake (`socket.handshake.auth.token`, verified the same way
as the REST `Authorization: Bearer` header) — there's no legitimate anonymous use of the
socket layer here, so unauthenticated connections are rejected outright rather than
allowed through and checked per-event.

Every user's socket(s) join a `user:<id>` room on connect; `sockets/ioRegistry.js`'s
`emitToUser()` is how any service (not just socket handlers) pushes to a specific member
without needing to track raw socket IDs itself.

**Connection loss mid-match**: on disconnect, if the member has an active match, the
opponent gets `opponent:disconnected` immediately and a `RECONNECT_WINDOW_MS`-long timer
(5 minutes by default — see `.env.example`) starts. Reconnecting cancels it and notifies
the opponent (`opponent:reconnected`). Expiring it settles the match as a forfeit against
whoever didn't come back. This state is in-memory (a `Map` in
`connectionTimeoutTracker.js`) — fine for one server process; a multi-instance deployment
would need it moved to a shared/persistent scheduler so a server restart mid-window
doesn't silently drop the clock.

## Push notifications

Web Push, not the Socket.IO layer above — the whole point is reaching someone whose tab
isn't open (socket events only reach a live connection). `models/pushSubscription.model.js`
stores one row per browser/device a member has enabled it on; `utils/webPush.js` wraps the
`web-push` package with the VAPID keypair from `.env` and is what every trigger point calls.
A 404/410 from the push service (the browser uninstalled, permission revoked, endpoint
expired) deletes that subscription; anything else is left alone since it's not evidence the
subscription itself is bad.

Triggers currently wired in `challenges/challenge.service.js`: `challenge:incoming` (someone
targeted you) and `challenge:accepted` (someone accepted yours) each fire a push right next
to the socket emit for the same event — same information, two delivery paths, since a push
notification is a complement to the real-time socket push, not a replacement for it (both
fire on every event; there's no "only push if the socket isn't connected" branching, since
there's no reliable way to know from the server whether the other side's tab is actually in
the foreground reading it).

Sending is fire-and-forget (`sendPushToUser` isn't awaited by its callers) and never throws
into the action that triggered it — accepting a challenge should never fail because a push
notification failed to send. See `.env.example` for how to generate a VAPID keypair; without
one configured, this whole feature silently no-ops (one warning logged, not a startup
failure) rather than needing to be toggled off somewhere.

## Frontend wiring required

Two small frontend changes were made alongside this backend (both already applied in the
PWA project) so the two sides actually interoperate:

1. **`api/client.js`** needs to attach `Authorization: Bearer <token>` using the token
   `useAuthStore` now holds after sign-in.
2. **`socket/socketClient.js`**'s `createSocket()` now takes a token argument and passes
   it as `{ auth: { token } }` — already wired in `useSocketBridge.js`.

Point the frontend's `API_BASE` (`api/client.js`) and `SOCKET_URL`
(`socket/socketClient.js`) at wherever this server is actually running, and every
local-fallback path in the frontend stops being used automatically — no other frontend
code needs to change.

## Endpoint map (frontend call -> backend route)

| Frontend (`api/*.js`) | Method + path |
|---|---|
| `authApi.signIn` | `POST /auth/signin` |
| `authApi.signUp` | `POST /auth/signup` |
| `authApi.signInWithOAuth` | `POST /auth/oauth/:provider` |
| `authApi.forgotPassword` | `POST /auth/forgot-password` |
| `walletApi.initializeDeposit` | `POST /wallet/deposit/initialize` |
| `walletApi.verifyDeposit` | `POST /wallet/deposit/verify` |
| `walletApi.initializeWithdrawal` | `POST /wallet/withdraw/initialize` |
| `walletApi.getBanks` | `GET /wallet/banks` |
| `walletApi.resolveAccount` | `GET /wallet/resolve-account` |
| *(Paystack, not the frontend)* | `POST /wallet/webhook/paystack` |
| `lobbyApi.getPlayers` | `GET /lobby/players` |
| `challengeApi.create` | `POST /challenges` |
| `challengeApi.getStatus` | `GET /challenges/:id` |
| `challengeApi.accept` | `POST /challenges/:id/accept` |
| `challengeApi.decline` | `POST /challenges/:id/decline` |
| `challengeApi.update` | `PATCH /challenges/:id` |
| `challengeApi.delete` | `DELETE /challenges/:id` |
| `matchApi.submitMove` | `POST /matches/:id/moves` (+ `match:move` socket event) |
| `matchApi.reportResult` | `POST /matches/:id/result` |
| `chatApi.getMessages` | `GET /matches/:id/messages` |
| `chatApi.sendMessage` | `POST /matches/:id/messages` (+ `match:chat` socket event, ack-based — see matchHandler.js) |
| `pushApi.getVapidPublicKey` | `GET /push/vapid-public-key` |
| `pushApi.subscribe` | `POST /push/subscribe` |
| `pushApi.unsubscribe` | `POST /push/unsubscribe` |

Socket events emitted **by the server**: `challenge:incoming`, `challenge:accepted`,
`challenge:declined`, `match:move`, `match:ended`, `match:chat`, `opponent:disconnected`,
`opponent:reconnected`, `wallet:balance` (emitted after a Paystack deposit/withdrawal
resolves — see wallet.service.js), `lobby:update` (not emitted anywhere yet — see Known
gaps).

## Design decisions worth knowing about

- **Lobby "stake" per player**: the frontend's players table shows one stake number per
  row and challenges for exactly that amount on click — there was never a "pick your
  stake" step on that path. Real backend behavior: a player's own currently-open
  challenge amount if they have one, otherwise a flat fallback (`DEFAULT_DISPLAY_STAKE`
  in `lobby.service.js`). A "preferred stake" profile setting would be a more product-y
  answer than a hardcoded fallback — not built, since nothing currently asks for one.
- **Challenging "by name"**: `POST /challenges` resolves `opponentName` to a user id via
  a name lookup, since that's all the frontend's lobby list currently sends. Names aren't
  unique in the schema (only email is) — an ambiguous or missing name is a 400. A real
  product would pass the id the lobby list already has instead.
- **One open challenge per member** is enforced server-side
  (`challenge.service.js#assertNoExistingOpenChallenge`), matching the frontend's
  editable/deletable "your open challenge" card. This only applies to *open* challenges
  (no specific opponent) — direct challenges resolve quickly enough not to need the same
  bookkeeping.

## Known gaps / next steps

- **OAuth token verification is a stub.** With no `GOOGLE_CLIENT_ID` / `FACEBOOK_APP_ID`
  set, `oauth.service.js` trusts whatever name the client claims — enough to exercise the
  rest of the flow locally, but not secure. Real verification (hitting Google's
  `tokeninfo` / Facebook's `debug_token` endpoints) is a `TODO` in that file.
- **Paystack is the payment processor now**, but a few real-world pieces are still
  simplified: transfer recipient `type` is hardcoded to `'nuban'` in `utils/paystack.js`
  (Nigerian bank accounts) — a Paystack account registered in a different country needs
  that, and the account-number format the withdrawal form collects, changed to match.
  There's also no KYC/AML identity verification before a withdrawal goes out, which most
  jurisdictions require for real-money payouts.
- **No password reset emails.** `POST /auth/forgot-password` returns the right (generic,
  enumeration-safe) response but doesn't send anything — no mailer is configured.
- **`lobby:update` socket event** is listened for by the frontend but nothing here emits
  it yet — `GET /lobby/players` covers the same data via polling in the meantime.
  (`wallet:balance` *is* now emitted — see wallet.service.js.)
- **Migrations use `sequelize.sync({ alter: true })`**, not versioned migration files —
  fine while the schema's still moving alongside the frontend, but a production
  deployment should switch to real Sequelize-CLI migrations so schema changes are
  reviewable and reversible instead of inferred from the current model definitions.
# chessfifapp0
