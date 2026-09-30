import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export function signToken(userId) {
  return jwt.sign({ sub: userId }, env.jwt.secret, { expiresIn: env.jwt.expiresIn });
}

export function verifyToken(token) {
  return jwt.verify(token, env.jwt.secret); // throws on invalid/expired — callers handle it
}
