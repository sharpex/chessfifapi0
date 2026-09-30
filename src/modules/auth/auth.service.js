import crypto from 'node:crypto';
import { sequelize, User } from '../../models/index.js';
import { hashPassword, comparePassword } from '../../utils/password.js';
import { signToken } from '../../utils/jwt.js';
import { ApiError } from '../../utils/ApiError.js';
import { env } from '../../config/env.js';
import * as walletService from '../wallet/wallet.service.js';
import { verifyOAuthToken } from './oauth.service.js';
import { broadcastToAll } from '../../sockets/ioRegistry.js';
import { sendPasswordResetEmail } from '../../utils/mailer.js';

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

function hashResetToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

async function createMemberWithAccounts({ name, email, passwordHash, provider, providerId }) {
  const newUser = await sequelize.transaction(async t => {
    const user = await User.create({ name, email, passwordHash, provider, providerId }, { transaction: t });
    await walletService.createAccountsForUser(user.id, env.demoSignupBonus, t);
    return user;
  });
  // Lets everyone already in the lobby (members and guests alike — the lobby itself is
  // guest-visible, see lobby.routes.js) find out a new player just joined without needing
  // to refresh; the frontend toasts this and refreshes the players list (see
  // useSocketBridge.js's onPlayerRegistered). Outside the transaction since this is a pure
  // notification, not something that needs to roll back with it, and only makes sense once
  // the account is actually committed. The new member isn't connected under their own
  // identity yet at this point (their socket only connects once they have the token this
  // function's caller is about to issue), so there's no need to exclude them from this.
  broadcastToAll('lobby:playerRegistered', { name: newUser.name });
  return newUser;
}

export async function signUp({ name, email, password }) {
  if (!name || !name.trim()) throw new ApiError(400, 'Name is required.');
  if (email) {
    const existing = await User.findOne({ where: { email } });
    if (existing) throw new ApiError(409, 'An account with that email already exists.');
  }
  const passwordHash = password ? await hashPassword(password) : null;
  const user = await createMemberWithAccounts({ name: name.trim(), email: email || null, passwordHash, provider: 'local' });
  return { token: signToken(user.id), user: user.toPublicJSON() };
}

export async function signIn({ email, password }) {
  const user = await User.findOne({ where: { email } });
  if (!user || !(await comparePassword(password, user.passwordHash))) {
    throw new ApiError(401, 'Invalid email or password.');
  }
  return { token: signToken(user.id), user: user.toPublicJSON() };
}

export async function signInWithOAuth(provider, token, clientClaimedName) {
  const verified = await verifyOAuthToken(provider, token, clientClaimedName);
  let user = await User.findOne({ where: { provider, providerId: verified.providerId } });
  if (!user) {
    // First time this provider identity has signed in — provision a new member, same as
    // a normal signup, just without a password.
    user = await createMemberWithAccounts({
      name: verified.name || 'Player',
      email: verified.email,
      passwordHash: null,
      provider,
      providerId: verified.providerId
    });
  }
  return { token: signToken(user.id), user: user.toPublicJSON() };
}

/** Always returns the same shape whether or not the email is registered — the controller
 *  relays this as one generic message either way, so the endpoint can't be used to check
 *  which emails have accounts. A registered email gets a signed, expiring (1 hour) reset
 *  token emailed to them; only its SHA-256 hash is ever persisted (see the User model),
 *  and it's single-use — resetPassword below clears it the moment it's redeemed. */
export async function forgotPassword(email) {
  const user = await User.findOne({ where: { email } });
  if (user) {
    const rawToken = crypto.randomBytes(32).toString('hex');
    user.resetPasswordTokenHash = hashResetToken(rawToken);
    user.resetPasswordExpiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
    await user.save();

    // The frontend has no client-side router (see useResetPasswordLink.js) — it reads
    // this token straight off the query string on load, the same way a shared challenge
    // link already works (see shareLink.js).
    const resetUrl = `${env.frontendUrl}?resetToken=${rawToken}`;
    await sendPasswordResetEmail(email, resetUrl);
  }
  return { ok: true };
}

/** Redeems a reset token: verifies it against the stored hash and expiry, sets the new
 *  password, and clears the token fields so it can't be reused. Signs the member in
 *  immediately on success (same as signUp/signIn) so they don't have to separately log in
 *  right after resetting. */
export async function resetPassword(rawToken, newPassword) {
  if (!rawToken) throw new ApiError(400, 'Missing reset token.');
  const tokenHash = hashResetToken(rawToken);
  const user = await User.findOne({ where: { resetPasswordTokenHash: tokenHash } });
  if (!user || !user.resetPasswordExpiresAt || user.resetPasswordExpiresAt < new Date()) {
    throw new ApiError(400, 'This reset link is invalid or has expired — request a new one.');
  }

  user.passwordHash = await hashPassword(newPassword);
  user.resetPasswordTokenHash = null;
  user.resetPasswordExpiresAt = null;
  await user.save();

  return { token: signToken(user.id), user: user.toPublicJSON() };
}
