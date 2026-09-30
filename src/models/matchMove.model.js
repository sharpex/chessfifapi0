import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../config/database.js';

export class MatchMove extends Model {}

MatchMove.init(
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
    playerId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    moveNumber: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    color: {
      type: DataTypes.ENUM('w', 'b'),
      allowNull: false
    },
    san: {
      type: DataTypes.STRING(16),
      allowNull: false
    },
    fenAfter: {
      type: DataTypes.STRING(100),
      allowNull: false
    }
  },
  {
    sequelize,
    modelName: 'MatchMove',
    tableName: 'match_moves',
    indexes: [{ fields: ['match_id', 'move_number'] }]
  }
);
