import { sequelize } from '../config/database.js';
import '../models/index.js';

/** Uses Sequelize's sync() rather than versioned migration files — reasonable for this
 *  demo/staging backend, where the schema is still moving with the frontend. A production
 *  deployment should switch to proper Sequelize-CLI migrations (one file per schema
 *  change, checked into version control and applied in order) so schema changes are
 *  reviewable and reversible instead of inferred from the current model definitions. */
async function migrate() {
  await sequelize.authenticate();
  console.log('Connected. Syncing schema...');
  await sequelize.sync({ alter: true });
  console.log('Schema is up to date.');
  await sequelize.close();
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
