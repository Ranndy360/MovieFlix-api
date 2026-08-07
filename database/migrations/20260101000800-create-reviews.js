'use strict';

const TABLE = 'reviews';

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
      rating: { type: Sequelize.SMALLINT, allowNull: false },
      comment: { type: Sequelize.TEXT, allowNull: true },
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
      deleted_at: { type: Sequelize.DATE, allowNull: true },
    });

    // The 1–5 range is validated in the DTO; this makes it true of the data
    // regardless of which code path writes it.
    await queryInterface.sequelize.query(
      `ALTER TABLE "${TABLE}" ADD CONSTRAINT reviews_rating_range CHECK (rating BETWEEN 1 AND 5);`,
    );

    // One review per user per movie — partial, so a soft-deleted review does
    // not permanently consume the slot.
    await queryInterface.addIndex(TABLE, ['user_id', 'movie_id'], {
      name: 'reviews_user_movie_key',
      unique: true,
      where: { deleted_at: null },
    });

    await queryInterface.addIndex(TABLE, ['movie_id'], { name: 'reviews_movie_id_idx' });
    await queryInterface.addIndex(TABLE, ['user_id'], { name: 'reviews_user_id_idx' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable(TABLE);
  },
};
