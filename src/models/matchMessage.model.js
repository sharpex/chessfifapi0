import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../config/database.js';

/** A chat message between the two players of one match — scoped and persisted per match
 *  (not a global/lobby chat), so it survives a page reload the same way the match itself
 *  does (see match.service.js's getActiveMatchForUser and this model's own
 *  getMatchMessages). Kept even after the match ends; there's no cleanup job removing old
 *  matches' messages, same as there's none for old matches themselves. */
export class MatchMessage extends Model {}

MatchMessage.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    matchId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    senderId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    text: {
      type: DataTypes.STRING(500),
      allowNull: false
    }
  },
  {
    sequelize,
    modelName: 'MatchMessage',
    tableName: 'match_messages',
    indexes: [{ fields: ['match_id', 'created_at'] }]
  }
);
