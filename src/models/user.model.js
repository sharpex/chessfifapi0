import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../config/database.js';

export class User extends Model {
  /** Never send passwordHash (or anything else sensitive) to the client — this is the
   *  one place that shape is defined, so every controller returns through it. */
  toPublicJSON() {
    return {
      id: this.id,
      name: this.name,
      email: this.email,
      provider: this.provider,
      createdAt: this.createdAt
    };
  }
}

User.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    name: {
      type: DataTypes.STRING(80),
      allowNull: false
    },
    email: {
      type: DataTypes.STRING(255),
      allowNull: true, // OAuth providers don't always share an email
      unique: true,
      validate: { isEmail: true }
    },
    passwordHash: {
      type: DataTypes.STRING(255),
      allowNull: true // null for OAuth-only accounts that never set a password
    },
    provider: {
      type: DataTypes.ENUM('local', 'google', 'facebook'),
      allowNull: false,
      defaultValue: 'local'
    },
    providerId: {
      type: DataTypes.STRING(255),
      allowNull: true // the provider's own user id, for OAuth accounts
    },
    // --- password reset (see auth.service.js's forgotPassword/resetPassword) ---
    // Only the SHA-256 hash of the raw token is ever stored, same principle as
    // passwordHash above — the raw token only ever exists in the emailed link and in
    // memory just long enough to hash it, so a DB leak alone can't be used to reset
    // anyone's password.
    resetPasswordTokenHash: {
      type: DataTypes.STRING(64),
      allowNull: true
    },
    resetPasswordExpiresAt: {
      type: DataTypes.DATE,
      allowNull: true
    }
  },
  {
    sequelize,
    modelName: 'User',
    tableName: 'users',
    indexes: [{ fields: ['provider', 'provider_id'] }]
  }
);
