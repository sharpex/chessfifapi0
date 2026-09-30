import { Sequelize } from 'sequelize';
import { env } from './env.js';

export const sequelize = new Sequelize(env.db.name, env.db.user, env.db.password, {
  host: env.db.host,
  port: env.db.port,
  dialect: 'mysql',
  logging: env.nodeEnv === 'development' ? false : false, // flip to console.log while debugging queries
  define: {
    // Sequelize's default camelCase<->snake_case handling — keeps JS side camelCase while
    // the actual MySQL columns are snake_case, which is the more conventional SQL style.
    underscored: true
  },
  pool: {
    max: 10,
    min: 0,
    acquire: 30000,
    idle: 10000
  }
});
