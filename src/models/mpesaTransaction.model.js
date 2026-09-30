import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../config/database.js';

/** One row per M-Pesa (Daraja) deposit or withdrawal attempt — the counterpart of
 *  PaystackTransaction for the other payment rail, kept as its own table because the two
 *  providers identify a payment with entirely different ids (Paystack: reference /
 *  recipient / transfer codes; Daraja: checkout-request and conversation ids) and merging
 *  them would mean half the columns are always null. Same role though: the durable record
 *  the callbacks reconcile against, and what makes settling idempotent (only a row still
 *  'pending' can be settled). */
export class MpesaTransaction extends Model {}

MpesaTransaction.init(
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
    // Our own unique reference. For a withdrawal it's also the OriginatorConversationID we
    // send to Daraja's B2C v3 endpoint (see utils/mpesa.js's initiateB2C).
    reference: {
      type: DataTypes.STRING(80),
      allowNull: false,
      unique: true
    },
    phoneNumber: {
      type: DataTypes.STRING(15), // normalized 2547XXXXXXXX
      allowNull: false
    },
    // Deposit: the amount charged to the customer and credited to the wallet.
    // Withdrawal: the gross amount debited from the wallet (refundFailedWithdrawal relies
    // on this being exactly what was taken) — what's actually sent is netAmount.
    amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false
    },
    // Withdrawal-only fee breakdown — see utils/mpesaFees.js.
    platformFee: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
    mpesaFee: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
    netAmount: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
    status: {
      type: DataTypes.ENUM('pending', 'success', 'failed'),
      allowNull: false,
      defaultValue: 'pending'
    },
    // Deposit (STK Push) ids
    merchantRequestId: { type: DataTypes.STRING(80), allowNull: true },
    checkoutRequestId: { type: DataTypes.STRING(80), allowNull: true },
    // Withdrawal (B2C) ids
    conversationId: { type: DataTypes.STRING(80), allowNull: true },
    // M-Pesa's own receipt code (e.g. "NLJ7RT61SV") once the payment completes.
    mpesaReceipt: { type: DataTypes.STRING(40), allowNull: true },
    // Why it failed — or, for a withdrawal still 'pending', a note that something needs
    // manual reconciliation (e.g. Safaricom's queue-timeout callback; see
    // mpesa.service.js's handleB2CTimeout).
    failureReason: { type: DataTypes.STRING(255), allowNull: true }
  },
  {
    sequelize,
    modelName: 'MpesaTransaction',
    tableName: 'mpesa_transactions',
    indexes: [
      { fields: ['user_id'] },
      { fields: ['checkout_request_id'] },
      { fields: ['status', 'kind'] }
    ]
  }
);
