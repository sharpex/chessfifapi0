import { sequelize } from '../config/database.js';
import { User } from './user.model.js';
import { Wallet } from './wallet.model.js';
import { WagerAccount } from './wagerAccount.model.js';
import { Challenge } from './challenge.model.js';
import { Match } from './match.model.js';
import { MatchMove } from './matchMove.model.js';
import { MatchMessage } from './matchMessage.model.js';
import { Transaction } from './transaction.model.js';
import { PaystackTransaction } from './paystackTransaction.model.js';
import { MpesaTransaction } from './mpesaTransaction.model.js';
import { PushSubscription } from './pushSubscription.model.js';

// --- User <-> Wallet (1:1) ---
User.hasOne(Wallet, { foreignKey: 'userId', as: 'wallet' });
Wallet.belongsTo(User, { foreignKey: 'userId' });

// --- User <-> WagerAccount (1:1) ---
User.hasOne(WagerAccount, { foreignKey: 'userId', as: 'wagerAccount' });
WagerAccount.belongsTo(User, { foreignKey: 'userId' });

// --- User <-> Transaction (1:many) ---
User.hasMany(Transaction, { foreignKey: 'userId', as: 'transactions' });
Transaction.belongsTo(User, { foreignKey: 'userId' });

// --- User <-> PaystackTransaction (1:many) ---
User.hasMany(PaystackTransaction, { foreignKey: 'userId', as: 'paystackTransactions' });
PaystackTransaction.belongsTo(User, { foreignKey: 'userId' });

// --- User <-> MpesaTransaction (1:many) --- the M-Pesa rail's counterpart of the above
User.hasMany(MpesaTransaction, { foreignKey: 'userId', as: 'mpesaTransactions' });
MpesaTransaction.belongsTo(User, { foreignKey: 'userId' });

// --- User <-> PushSubscription (1:many) ---
User.hasMany(PushSubscription, { foreignKey: 'userId', as: 'pushSubscriptions' });
PushSubscription.belongsTo(User, { foreignKey: 'userId' });

// --- Challenge relationships ---
User.hasMany(Challenge, { foreignKey: 'creatorId', as: 'createdChallenges' });
Challenge.belongsTo(User, { foreignKey: 'creatorId', as: 'creator' });
User.hasMany(Challenge, { foreignKey: 'opponentId', as: 'receivedChallenges' });
Challenge.belongsTo(User, { foreignKey: 'opponentId', as: 'opponent' });

// --- Match relationships ---
Challenge.hasOne(Match, { foreignKey: 'challengeId', as: 'match' });
Match.belongsTo(Challenge, { foreignKey: 'challengeId' });
User.hasMany(Match, { foreignKey: 'whitePlayerId', as: 'matchesAsWhite' });
Match.belongsTo(User, { foreignKey: 'whitePlayerId', as: 'whitePlayer' });
User.hasMany(Match, { foreignKey: 'blackPlayerId', as: 'matchesAsBlack' });
Match.belongsTo(User, { foreignKey: 'blackPlayerId', as: 'blackPlayer' });

// --- MatchMove relationships ---
Match.hasMany(MatchMove, { foreignKey: 'matchId', as: 'moves' });
MatchMove.belongsTo(Match, { foreignKey: 'matchId' });
User.hasMany(MatchMove, { foreignKey: 'playerId' });
MatchMove.belongsTo(User, { foreignKey: 'playerId' });

// --- MatchMessage relationships ---
Match.hasMany(MatchMessage, { foreignKey: 'matchId', as: 'messages' });
MatchMessage.belongsTo(Match, { foreignKey: 'matchId' });
User.hasMany(MatchMessage, { foreignKey: 'senderId' });
MatchMessage.belongsTo(User, { foreignKey: 'senderId', as: 'sender' });

export { sequelize, User, Wallet, WagerAccount, Challenge, Match, MatchMove, MatchMessage, Transaction, PaystackTransaction, MpesaTransaction, PushSubscription };
