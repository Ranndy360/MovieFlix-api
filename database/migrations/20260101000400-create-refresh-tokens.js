'use strict';

const TABLE = 'refresh_tokens';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable(TABLE, {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        primaryKey: true,
        allowNull: false,
      },
      user_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        // Deleting a user must take their sessions with them.
        onDelete: 'CASCADE',
      },
      jti: { type: Sequelize.UUID, allowNull: false, unique: true },
      token_hash: { type: Sequelize.STRING(64), allowNull: false },
      expires_at: { type: Sequelize.DATE, allowNull: false },
      revoked_at: { type: Sequelize.DATE, allowNull: true },
      replaced_by_jti: { type: Sequelize.UUID, allowNull: true },
      user_agent: { type: Sequelize.STRING(512), allowNull: true },
      ip_address: { type: Sequelize.STRING(64), allowNull: true },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.addIndex(TABLE, ['user_id'], { name: 'refresh_tokens_user_id_idx' });
    // Drives the "revoke every live session for this user" query.
    await queryInterface.addIndex(TABLE, ['user_id', 'revoked_at'], {
      name: 'refresh_tokens_active_idx',
      where: { revoked_at: null },
    });
    await queryInterface.addIndex(TABLE, ['expires_at'], { name: 'refresh_tokens_expires_at_idx' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable(TABLE);
  },
};
