import * as pushService from './push.service.js';
import { getVapidPublicKey } from '../../utils/webPush.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

/** Matches frontend: pushApi.getVapidPublicKey() -> GET /push/vapid-public-key. Public —
 *  it's not a secret (that's the point of VAPID's public/private split), and the frontend
 *  needs it before the person has necessarily signed in to even show the enable button. */
export const vapidPublicKey = asyncHandler(async (req, res) => {
  res.json({ publicKey: getVapidPublicKey() });
});

/** Matches frontend: pushApi.subscribe(subscription) -> POST /push/subscribe. */
export const subscribe = asyncHandler(async (req, res) => {
  const result = await pushService.saveSubscription(req.user.id, req.body);
  res.json(result);
});

/** Matches frontend: pushApi.unsubscribe(endpoint) -> POST /push/unsubscribe. */
export const unsubscribe = asyncHandler(async (req, res) => {
  const result = await pushService.removeSubscription(req.user.id, req.body.endpoint);
  res.json(result);
});
