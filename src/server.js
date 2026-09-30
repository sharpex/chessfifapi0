import http from 'http';
import { createApp } from './app.js';
import { createSocketServer } from './sockets/index.js';
import { sequelize } from './config/database.js';
import { env } from './config/env.js';
import './models/index.js'; // registers associations before anything queries them
import { startMpesaReconciler } from './modules/mpesa/mpesa.service.js';

async function start() {
  await sequelize.authenticate();
  console.log('Database connection established.');

  const app = createApp();
  const httpServer = http.createServer(app);
  createSocketServer(httpServer);

  // No-ops if M-Pesa deposits aren't configured — see startMpesaReconciler's own comment.
  startMpesaReconciler();

  httpServer.listen(env.port, () => {
    console.log(`ChessFifa API listening on port ${env.port} (${env.nodeEnv})`);
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
