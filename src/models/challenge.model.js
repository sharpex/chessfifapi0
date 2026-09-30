import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../config/database.js';

/** Covers both flavors the frontend creates:
 *   - Direct challenge: opponentId is set at creation — the client sends the target's real
 *     User id directly (from the lobby list's own data), not a name to resolve, so this
 *     never depends on names being unique (see challenge.service.js).
 *   - Open challenge: opponentId is null until someone accepts it. A user may only have
 *     one open (status='open', opponentId=null, creatorId=them) challenge at a time —
 *     enforced in challenge.service.js, not at the DB level, so the error message can be
 *     friendlier than a raw constraint violation. */
export class Challenge extends Model {}

Challenge.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    creatorId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    opponentId: {
      type: DataTypes.UUID,
      allowNull: true // null = open challenge, anyone can accept
    },
    stake: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      validate: { min: 0.01 }
    },
    status: {
      type: DataTypes.ENUM('open', 'accepted', 'declined', 'cancelled'),
      allowNull: false,
      defaultValue: 'open'
    },
    matchId: {
      type: DataTypes.UUID,
      allowNull: true // set once accepted and a Match is created from it
    }
  },
  {
    sequelize,
    modelName: 'Challenge',
    tableName: 'challenges',
    indexes: [
      { fields: ['creator_id', 'status'] },
      { fields: ['opponent_id', 'status'] }
    ]
  }
);
