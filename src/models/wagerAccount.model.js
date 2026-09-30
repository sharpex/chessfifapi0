import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../config/database.js';

/** A member's wagering-specific account — separate from Wallet on purpose. escrowBalance
 *  is funds currently locked in an active challenge/match (moved out of Wallet.balance
 *  the moment a match begins, moved back — or to the opponent — the moment it settles).
 *  The lifetime totals exist for a future profile/stats view; nothing reads them yet. */
export class WagerAccount extends Model {}

WagerAccount.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
      unique: true
    },
    escrowBalance: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
      validate: { min: 0 }
    },
    lifetimeWagered: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0
    },
    lifetimeWon: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0
    },
    lifetimeLost: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0
    },
    matchesPlayed: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    }
  },
  {
    sequelize,
    modelName: 'WagerAccount',
    tableName: 'wager_accounts'
  }
);
