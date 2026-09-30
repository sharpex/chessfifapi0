import * as legalService from './legal.service.js';

/** Matches frontend: legalApi.getTerms() -> GET /legal/terms. Public — same reasoning as
 *  every other public GET in this app (vapid key, Google client id): this is content
 *  every visitor needs to see, including before signing in (see AuthModal's checkbox). */
export const getTerms = (req, res) => {
  res.json(legalService.getTerms());
};

/** Matches frontend: legalApi.getPrivacyPolicy() -> GET /legal/privacy. Public, same
 *  reasoning as getTerms above. */
export const getPrivacyPolicy = (req, res) => {
  res.json(legalService.getPrivacyPolicy());
};
