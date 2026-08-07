'use strict';

const TABLE = 'roles';

const ROLES = [
  { name: 'ADMIN', description: 'Full access to every resource and to user administration.' },
  { name: 'PROVIDER', description: 'Can publish and manage catalog content.' },
  { name: 'USER', description: 'Default role for self-registered accounts. Read-only catalog.' },
];

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const now = new Date();

    // Idempotent: re-running the seeders must not fail on the unique index.
    const [existing] = await queryInterface.sequelize.query(
      `SELECT name FROM "${TABLE}";`,
    );
    const present = new Set(existing.map((row) => row.name));
    const missing = ROLES.filter((role) => !present.has(role.name));

    if (missing.length === 0) return;

    await queryInterface.bulkInsert(
      TABLE,
      missing.map((role) => ({ ...role, created_at: now, updated_at: now })),
    );
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete(TABLE, {
      name: { [Sequelize.Op.in]: ROLES.map((role) => role.name) },
    });
  },
};
