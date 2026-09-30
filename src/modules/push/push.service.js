import { PushSubscription } from '../../models/index.js';
import { ApiError } from '../../utils/ApiError.js';

export async function saveSubscription(userId, { endpoint, keys }) {
  if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
    throw new ApiError(400, 'Invalid push subscription.');
  }
  // A given browser's endpoint is stable across repeat subscribe calls (re-enabling after
  // unsubscribing, or the button firing twice) — upsert on it rather than erroring on the
  // unique constraint or piling up duplicate rows for the same device.
  const [subscription] = await PushSubscription.upsert(
    { userId, endpoint, p256dh: keys.p256dh, auth: keys.auth },
    { returning: true }
  );
  return { ok: true, id: subscription.id };
}

export async function removeSubscription(userId, endpoint) {
  if (!endpoint) throw new ApiError(400, 'Missing endpoint.');
  await PushSubscription.destroy({ where: { userId, endpoint } });
  return { ok: true };
}
