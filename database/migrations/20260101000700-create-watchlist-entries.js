'use strict';

const TABLE = 'watchlist_entries';
const STATUS_ENUM = 'enum_watchlist_entries_status';
const STATUSES = ['WANT', 'WATCHING', 'WATCHED'];

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
        onDelete: 'CASCADE',
      },
      movie_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'movies', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      status: { type: Sequelize.ENUM(...STATUSES), allowNull: false, defaultValue: 'WANT' },
      watched_at: { type: Sequelize.DATE, allowNull: true },
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

    // A watchlist is a set: one row per (user, movie). Enforced in the database
    // so a race between two concurrent "add" requests cannot duplicate an entry.
    await queryInterface.addIndex(TABLE, ['user_id', 'movie_id'], {
      name: 'watchlist_entries_user_movie_key',
      unique: true,
    });

    // Drives "my list, filtered by status" — the primary read path.
    await queryInterface.addIndex(TABLE, ['user_id', 'status'], {
      name: 'watchlist_entries_user_status_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable(TABLE);
    await queryInterface.sequelize.query(`DROP TYPE IF EXISTS "${STATUS_ENUM}";`);
  },
};
