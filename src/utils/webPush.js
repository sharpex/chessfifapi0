import webpush from 'web-push';
import { Op } from 'sequelize';
import { env } from '../config/env.js';
import { PushSubscription } from '../models/index.js';

let configured = false;
let warnedOnce = false;

function ensureConfigured() {
  if (configured) return true;
  if (!env.vapid.publicKey || !env.vapid.privateKey) {
    if (!warnedOnce) {
      warnedOnce = true;
      console.warn('Push notifications are disabled: VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY are not set. See .env.example.');
    }
    return false;
  }
  webpush.setVapidDetails(env.vapid.subject, env.vapid.publicKey, env.vapid.privateKey);
  configured = true;
  return true;
}

/** Sends a push notification to every subscription a user has (phone, laptop, a second
 *  browser — however many they've enabled it on). Best-effort: a failure to reach one
 *  subscription doesn't affect the others, and this never throws into its caller — a push
 *  notification is a bonus on top of the real-time socket event, not something that
 *  should be able to break the action that triggered it (e.g. accepting a challenge). */
export async function sendPushToUser(userId, { title, body, data }) {
  try {
    if (!ensureConfigured()) return;

    const subscriptions = await PushSubscription.findAll({ where: { userId } });
    if (subscriptions.length === 0) return;

    const payload = JSON.stringify({ title, body, data: data || {} });

    await Promise.all(
      subscriptions.map(async sub => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload
          );
        } catch (err) {
          // 404/410 means the push service itself says this subscription is gone (browser
          // uninstalled, permission revoked, endpoint expired) — clean it up so future
          // sends don't keep retrying a dead address. Any other error (network blip, etc.)
          // is left alone; it's not evidence the subscription itself is bad.
          if (err && (err.statusCode === 404 || err.statusCode === 410)) {
            await sub.destroy().catch(() => {});
          }
        }
      })
    );
  } catch (err) {
    // Callers deliberately don't await this (see challenge.service.js) so a push failure
    // can never delay or break the action that triggered it — so nothing here is allowed
    // to escape as an unhandled rejection either.
    console.error('sendPushToUser failed:', err.message);
  }
}

export function getVapidPublicKey() {
  return env.vapid.publicKey || null;
}

/** Same delivery semantics as sendPushToUser above (best-effort, dead subscriptions
 *  cleaned up, never throws into its caller) but fans out to every subscription on the
 *  platform except the given user's own — for a lobby-wide announcement (a new open
 *  challenge anyone can accept, say) where notifying the person who just caused the event
 *  about their own action would be confusing. Pass a falsy excludeUserId to genuinely
 *  reach everyone, though every current caller has someone to exclude.
 *
 *  No attempt at batching/rate-limiting beyond web-push's own per-call cost — fine for a
 *  lobby of the size this app is built for; a much larger user base would want to batch
 *  these sends rather than Promise.all-ing every subscription on the platform at once. */
export async function sendPushToAllExcept(excludeUserId, { title, body, data }) {
  try {
    if (!ensureConfigured()) return;

    const subscriptions = await PushSubscription.findAll({
      where: excludeUserId ? { userId: { [Op.ne]: excludeUserId } } : {}
    });
    if (subscriptions.length === 0) return;

    const payload = JSON.stringify({ title, body, data: data || {} });

    await Promise.all(
      subscriptions.map(async sub => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload
          );
        } catch (err) {
          if (err && (err.statusCode === 404 || err.statusCode === 410)) {
            await sub.destroy().catch(() => {});
          }
        }
      })
    );
  } catch (err) {
    console.error('sendPushToAllExcept failed:', err.message);
  }
}
