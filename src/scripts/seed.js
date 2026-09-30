import { sequelize } from '../config/database.js';
import { User } from '../models/index.js';
import { hashPassword } from '../utils/password.js';
import * as walletService from '../modules/wallet/wallet.service.js';
import { env } from '../config/env.js';

/** A handful of demo accounts, reusing the same flavor names the frontend's old
 *  mock lobby data used (CedarKnight, RookMother, etc.) so manual testing feels
 *  continuous with what the UI already showed before a real backend existed.
 *
 *  Note: seeding a user here does NOT make them appear in the lobby — GET /lobby/players
 *  only lists members with a live socket connection (see modules/lobby/lobby.service.js).
 *  These accounts exist so you can sign in as one in a second browser/tab and have a real
 *  counterpart to challenge by name; they won't show up passively just by being seeded. */
const DEMO_USERS = [
  { name: 'CedarKnight', email: 'cedarknight@example.com', password: 'password123' },
  { name: 'RookMother', email: 'rookmother@example.com', password: 'password123' },
  { name: 'BrassPawn', email: 'brasspawn@example.com', password: 'password123' },
  { name: 'MahoganyQueen', email: 'mahoganyqueen@example.com', password: 'password123' },
  { name: 'FeltAndFire', email: 'feltandfire@example.com', password: 'password123' }
];

async function seed() {
  await sequelize.authenticate();

  for (const demo of DEMO_USERS) {
    const existing = await User.findOne({ where: { email: demo.email } });
    if (existing) {
      console.log(`Skipping ${demo.name} — already exists.`);
      continue;
    }
    const user = await sequelize.transaction(async t => {
      const created = await User.create(
        { name: demo.name, email: demo.email, passwordHash: await hashPassword(demo.password), provider: 'local' },
        { transaction: t }
      );
      await walletService.createAccountsForUser(created.id, env.demoSignupBonus, t);
      return created;
    });
    console.log(`Created ${user.name} <${user.email}> — password: ${demo.password}`);
  }

  console.log('Seed complete.');
  await sequelize.close();
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
