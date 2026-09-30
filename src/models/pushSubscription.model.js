import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../config/database.js';

/** One row per browser/device a user has enabled push notifications on — a person could
 *  have several (phone, laptop, a second browser) and all of them get notified. `endpoint`
 *  is the push service URL the browser's PushManager generated (unique per subscription,
 *  effectively per browser-install); `p256dh`/`auth` are the encryption keys Web Push
 *  needs to encrypt the payload so only that browser can read it — see utils/webPush.js. */
export class PushSubscription extends Model {}

PushSubscription.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    userId: { type: DataTypes.UUID, allowNull: false },
    endpoint: { type: DataTypes.STRING(500), allowNull: false, unique: true },
    p256dh: { type: DataTypes.STRING(255), allowNull: false },
    auth: { type: DataTypes.STRING(255), allowNull: false }
  },
  {
    sequelize,
    modelName: 'PushSubscription',
    tableName: 'push_subscriptions',
    indexes: [{ unique: true, fields: ['endpoint'] }, { fields: ['user_id'] }]
  }
);
