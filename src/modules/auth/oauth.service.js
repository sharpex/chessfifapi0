import { OAuth2Client } from 'google-auth-library';
import { env } from '../../config/env.js';
import { ApiError } from '../../utils/ApiError.js';

// Reused across requests rather than constructed per-call — the client itself holds no
// per-request state, it's just a thin wrapper around the Google client id used to check
// verifyIdToken's `audience` (see below), plus some internal caching of Google's public
// signing keys so most verifications don't need a fresh network fetch.
const googleClient = env.oauth.googleClientId ? new OAuth2Client(env.oauth.googleClientId) : null;

/** Verifies an OAuth token from the client and returns { providerId, name, email }.
 *
 *  With no GOOGLE_CLIENT_ID / FACEBOOK_APP_ID configured (the default for local dev —
 *  see .env.example), this can't actually verify anything against Google/Facebook's
 *  servers, so it trusts whatever the client sent instead. That's fine for exercising
 *  the rest of the flow locally, but is NOT secure — anyone could claim to be anyone. */
export async function verifyOAuthToken(provider, token, clientClaimedName) {
  if (provider === 'google') {
    if (!googleClient) {
      return { providerId: 'demo-google-' + (clientClaimedName || 'user'), name: clientClaimedName || 'Google User', email: null };
    }
    if (!token) throw new ApiError(400, 'Missing Google credential.');
    // verifyIdToken checks the JWT's signature against Google's published public keys
    // (fetched and cached internally), that it hasn't expired, and — critically — that its
    // `aud` (audience) claim matches OUR client id, so a token minted for some other app
    // can't be replayed here. `sub` (the payload below) is Google's own stable, unique id
    // for the account; it's what actually identifies the person, never anything the client
    // sent alongside the token, which is why clientClaimedName is only ever used as a
    // display-name fallback in the two branches below, not as identity.
    let ticket;
    try {
      ticket = await googleClient.verifyIdToken({ idToken: token, audience: env.oauth.googleClientId });
    } catch (err) {
      throw new ApiError(401, 'Could not verify Google sign-in — the token was invalid or expired.');
    }
    const payload = ticket.getPayload();
    if (!payload?.sub) throw new ApiError(401, 'Could not verify Google sign-in.');
    return { providerId: payload.sub, name: payload.name || clientClaimedName || 'Google User', email: payload.email || null };
  }
  if (provider === 'facebook') {
    if (!env.oauth.facebookAppId) {
      return { providerId: 'demo-facebook-' + (clientClaimedName || 'user'), name: clientClaimedName || 'Facebook User', email: null };
    }
    // TODO: verify `token` against Facebook's debug_token endpoint using env.oauth.facebookAppId/Secret:
    //   https://graph.facebook.com/debug_token?input_token=<token>&access_token=<app_id>|<app_secret>
    // and use the verified user id from THAT response, never the client's claim — same
    // principle as the Google branch above, just not wired up yet.
    throw new ApiError(501, 'Facebook token verification not yet implemented for a configured app ID.');
  }
  throw new ApiError(400, `Unknown OAuth provider: ${provider}`);
}
