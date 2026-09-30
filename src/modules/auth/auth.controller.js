import * as authService from './auth.service.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { env } from '../../config/env.js';

/** All three auth endpoints return the same flattened shape — { token, name, id, email }
 *  — because the frontend reads `result.name` and `result.token` directly (see
 *  AuthModal.jsx's completeAuthAndRoute calls) rather than expecting a nested `user`
 *  object. `token` is also returned so client.js can attach it as a Bearer header on
 *  every subsequent request (see useAuthStore.js / api/client.js). */
function toAuthResponse({ token, user }) {
  return { token, name: user.name, id: user.id, email: user.email };
}

export const signUp = asyncHandler(async (req, res) => {
  const { name, email, password } = req.body;
  const result = await authService.signUp({ name, email, password });
  res.status(201).json(toAuthResponse(result));
});

export const signIn = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const result = await authService.signIn({ email, password });
  res.json(toAuthResponse(result));
});

export const oauthSignIn = asyncHandler(async (req, res) => {
  const { provider } = req.params;
  const { token, name } = req.body; // `name` here is the client's claimed display name — see oauth.service.js's caveat about trusting it
  const result = await authService.signInWithOAuth(provider, token, name);
  res.json(toAuthResponse(result));
});

/** Matches frontend: authApi.getGoogleClientId() -> GET /auth/google-client-id. Public —
 *  a Google OAuth client id isn't a secret (it's embedded directly in every app's frontend
 *  JS as a matter of course; Google's own docs publish it in client-side code samples), so
 *  serving it up unauthenticated is fine, same reasoning as push.controller.js's
 *  vapidPublicKey. The frontend needs it before the person has signed in at all, to even
 *  initialize Google Identity Services for the "Continue with Google" button (see
 *  utils/googleAuth.js) — empty string when GOOGLE_CLIENT_ID isn't configured, which the
 *  frontend treats as "Google sign-in isn't set up here" rather than an error. */
export const googleClientId = asyncHandler(async (req, res) => {
  res.json({ clientId: env.oauth.googleClientId || '' });
});

export const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  await authService.forgotPassword(email);
  // Same message regardless of whether the account exists — the frontend already shows
  // this generic wording itself, but the API response should never leak that detail either.
  res.json({ message: 'If an account exists for that email, a reset link has been sent.' });
});

/** Matches frontend: authApi.resetPassword(token, password) -> POST /auth/reset-password.
 *  Returns the same { token, name, id, email } shape as sign-up/sign-in — a successful
 *  reset signs the member straight in, same reasoning as toAuthResponse's own comment. */
export const resetPassword = asyncHandler(async (req, res) => {
  const { token, password } = req.body;
  const result = await authService.resetPassword(token, password);
  res.json(toAuthResponse(result));
});

/** Matches frontend: authApi.getMe() -> GET /auth/me. Lets a page reload restore identity
 *  from a token already in localStorage (see useAuthStore.js) without asking the person to
 *  sign in again — `authenticate` has already verified the token by the time this runs, so
 *  this just re-shapes req.user into the same response shape the other auth endpoints use. */
export const getMe = asyncHandler(async (req, res) => {
  res.json({ name: req.user.name, id: req.user.id, email: req.user.email });
});
