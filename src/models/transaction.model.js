import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../config/database.js';

/** Append-only audit trail. Every balance-changing action (deposit, withdrawal, escrow
 *  hold, escrow release, payout) writes one row here in the same DB transaction as the
 *  balance update itself — this is what makes a balance dispute answerable later instead
 *  of just trusting the current number. Nothing here is ever updated or deleted. */
export class Transaction extends Model {}

Transaction.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    type: {
      type: DataTypes.ENUM('deposit', 'withdrawal', 'withdrawal_refund', 'escrow_hold', 'escrow_release', 'payout', 'signup_bonus'),
      allowNull: false
    },
    amount: {
      // always positive; `type` implies the direction
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false
    },
    walletBalanceAfter: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false
    },
    escrowBalanceAfter: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false
    },
    matchId: {
      type: DataTypes.UUID,
      allowNull: true
    },
    challengeId: {
      type: DataTypes.UUID,
      allowNull: true
    }
  },
  {
    sequelize,
    modelName: 'Transaction',
    tableName: 'transactions',
    updatedAt: false, // append-only — no updated_at needed
    indexes: [{ fields: ['user_id', 'created_at'] }]
  }
);
