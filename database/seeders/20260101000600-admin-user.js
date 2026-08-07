'use strict';

const bcrypt = require('bcrypt');

const TABLE = 'users';

/**
 * Creates the bootstrap ADMIN account — the only way an ADMIN can come into
 * existence, since self-service signup is hard-wired to the USER role.
 *
 * Credentials come from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD so a real
 * environment never inherits the local default. Rotate the password
 * immediately after the first login.
 */
const ADMIN_EMAIL = (process.env.SEED_ADMIN_EMAIL || 'admin@movieflix.test').toLowerCase().trim();
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'Admin123!Change';
const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS || 12);

const SEED_USERS = [
  {
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    first_name: 'Movie',
    last_name: 'Admin',
    role: 'ADMIN',
  },
  {
    email: 'provider@movieflix.test',
    password: process.env.SEED_PROVIDER_PASSWORD || 'Provider123!Change',
    first_name: 'Demo',
    last_name: 'Provider',
    role: 'PROVIDER',
  },
  {
    email: 'user@movieflix.test',
    password: process.env.SEED_USER_PASSWORD || 'User123!Change',
    first_name: 'Demo',
    last_name: 'User',
    role: 'USER',
  },
];

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const now = new Date();

    const [roles] = await queryInterface.sequelize.query('SELECT id, name FROM "roles";');
    const roleIdByName = new Map(roles.map((role) => [role.name, role.id]));

    if (roleIdByName.size === 0) {
      throw new Error('Roles must be seeded before users. Run `npm run db:seed`.');
    }

    const [existing] = await queryInterface.sequelize.query(
      `SELECT email FROM "${TABLE}";`,
    );
    const present = new Set(existing.map((row) => row.email));

    const rows = [];

    for (const seed of SEED_USERS) {
      if (present.has(seed.email)) continue;

      const roleId = roleIdByName.get(seed.role);
      if (!roleId) throw new Error(`Missing role "${seed.role}" — seed roles first.`);

      rows.push({
        email: seed.email,
        password_hash: await bcrypt.hash(seed.password, BCRYPT_ROUNDS),
        first_name: seed.first_name,
        last_name: seed.last_name,
        role_id: roleId,
        is_active: true,
        failed_login_attempts: 0,
        locked_until: null,
        last_login_at: null,
        password_changed_at: now,
        created_at: now,
        updated_at: now,
        deleted_at: null,
      });
    }

    if (rows.length === 0) return;

    await queryInterface.bulkInsert(TABLE, rows);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete(TABLE, {
      email: { [Sequelize.Op.in]: SEED_USERS.map((seed) => seed.email) },
    });
  },
};
