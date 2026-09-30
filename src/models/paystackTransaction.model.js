import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../config/database.js';

/** Tracks one Paystack payment (deposit) or transfer (withdrawal) from the moment it's
 *  initialized until Paystack confirms it — separate from the append-only Transaction
 *  ledger (transaction.model.js), which only ever records money that has *actually*
 *  moved. A Transaction row is written once a row here resolves to 'success'.
 *
 *  `reference` is also this app's idempotency key: a deposit can be confirmed by either
 *  the Paystack webhook or the frontend's post-checkout verify call, whichever arrives
 *  first — both look up the same row by reference, lock it, and only credit the wallet if
 *  `status` is still 'pending'. Without that, a webhook arriving a second after the
 *  verify call already credited the wallet would credit it again. */
export class PaystackTransaction extends Model {}

PaystackTransaction.init(
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
    kind: {
      type: DataTypes.ENUM('deposit', 'withdrawal'),
      allowNull: false
    },
    reference: {
      type: DataTypes.STRING(100),
      allowNull: false,
      unique: true
    },
    amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false
    },
    // Withdrawal-only fee breakdown — see utils/withdrawalFees.js. `amount` above stays the
    // gross amount debited from the member's wallet (refundFailedWithdrawal relies on that
    // to restore the exact balance it took), while these three explain where the
    // difference between that and what Paystack was actually asked to send went.
    platformFee: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
    paystackFee: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
    netAmount: { type: DataTypes.DECIMAL(12, 2), allowNull: true }, // what was actually sent via Paystack's Transfer API
    status: {
      type: DataTypes.ENUM('pending', 'success', 'failed'),
      allowNull: false,
      defaultValue: 'pending'
    },
    // Withdrawal-only fields — who a 'withdrawal' row pays out to.
    bankCode: { type: DataTypes.STRING(20), allowNull: true },
    accountNumber: { type: DataTypes.STRING(30), allowNull: true },
    accountName: { type: DataTypes.STRING(120), allowNull: true },
    recipientCode: { type: DataTypes.STRING(60), allowNull: true }, // Paystack transfer-recipient code
    transferCode: { type: DataTypes.STRING(60), allowNull: true }, // Paystack transfer_code, once initiated
    failureReason: { type: DataTypes.STRING(255), allowNull: true }
  },
  {
    sequelize,
    modelName: 'PaystackTransaction',
    tableName: 'paystack_transactions',
    indexes: [{ unique: true, fields: ['reference'] }, { fields: ['user_id'] }]
  }
);
