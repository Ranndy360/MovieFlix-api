'use strict';

const TABLE = 'movies';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn(TABLE, 'created_by_id', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onUpdate: 'CASCADE',
      // Deleting the author must not delete the catalog entry: the movie
      // outlives the account. It simply becomes admin-only to manage.
      onDelete: 'SET NULL',
    });

    // Drives "the movies I created" on the management screen.
    await queryInterface.addIndex(TABLE, ['created_by_id'], {
      name: 'movies_created_by_id_idx',
    });

    // Every published/unpublished listing filters on this, and the partial
    // index keeps soft-deleted rows out of it.
    await queryInterface.addIndex(TABLE, ['is_published'], {
      name: 'movies_is_published_live_idx',
      where: { deleted_at: null },
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex(TABLE, 'movies_is_published_live_idx');
    await queryInterface.removeIndex(TABLE, 'movies_created_by_id_idx');
    await queryInterface.removeColumn(TABLE, 'created_by_id');
  },
};
