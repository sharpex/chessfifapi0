import express from 'express';
import cors from 'cors';
import { env } from './config/env.js';
import { errorHandler } from './middleware/errorHandler.js';

import authRoutes from './modules/auth/auth.routes.js';
import walletRoutes from './modules/wallet/wallet.routes.js';
import lobbyRoutes from './modules/lobby/lobby.routes.js';
import challengeRoutes from './modules/challenges/challenge.routes.js';
import matchRoutes from './modules/matches/match.routes.js';
import pushRoutes from './modules/push/push.routes.js';
import legalRoutes from './modules/legal/legal.routes.js';
import mpesaRoutes from './modules/mpesa/mpesa.routes.js';
import payHooksRoutes from './modules/mpesa/payHooks.routes.js';

export function createApp() {
  const app = express();

  app.use(cors({ origin: env.corsOrigin, credentials: true }));
  // Keep the raw request bytes around on req.rawBody — the Paystack webhook route needs
  // to HMAC the *exact* bytes Paystack signed, not a re-serialized copy of the parsed
  // JSON (which can differ in key order/whitespace and would break the signature check).
  app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));

  app.get('/health', (req, res) => res.json({ ok: true }));

  // Every prefix here matches api/client.js's API_BASE + the path each frontend api/*.js
  // module builds — see README "Endpoint map" for the full list against the frontend.
  app.use('/auth', authRoutes);
  app.use('/wallet', walletRoutes);
  app.use('/lobby', lobbyRoutes);
  app.use('/challenges', challengeRoutes);
  app.use('/matches', matchRoutes);
  app.use('/push', pushRoutes);
  app.use('/legal', legalRoutes);
  app.use('/mpesa', mpesaRoutes);
  // Not /mpesa/... on purpose — see payHooks.routes.js's own comment.
  app.use('/pay-hooks', payHooksRoutes);
  // No /ai route — AI-move computation is deliberately client-side only (see the
  // frontend's chess/engine.js), so practice games never hit this backend at all.

  app.use((req, res) => res.status(404).json({ message: 'Not found' }));
  app.use(errorHandler); // must be last — Express identifies it by its 4-arg signature

  return app;
}
