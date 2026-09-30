import { Server } from 'socket.io';
import { env } from '../config/env.js';
import { socketAuth } from './middleware/socketAuth.js';
import { registerConnectionHandlers } from './handlers/connectionHandler.js';
import { setIO } from './ioRegistry.js';

export function createSocketServer(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: env.corsOrigin, credentials: true }
  });

  io.use(socketAuth);
  io.on('connection', socket => registerConnectionHandlers(io, socket));

  setIO(io); // lets modules/*.service.js emit events without importing this file directly
  return io;
}
