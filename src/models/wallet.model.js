import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../config/database.js';

/** A member's spendable balance — separate from WagerAccount, which tracks funds
 *  currently locked in active challenges/matches. Deposits and withdrawals touch this;
 *  starting or settling a wager moves money between this and the wager account instead. */
export class Wallet extends Model {}

Wallet.init(
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
    balance: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
      validate: { min: 0 }
    }
  },
  {
    sequelize,
    modelName: 'Wallet',
    tableName: 'wallets'
  }
);
