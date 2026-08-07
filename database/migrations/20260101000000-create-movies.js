'use strict';

const TABLE = 'movies';
const GENRE_ENUM = 'enum_movies_genre';

const GENRES = [
  'ACTION',
  'ADVENTURE',
  'ANIMATION',
  'COMEDY',
  'DOCUMENTARY',
  'DRAMA',
  'HORROR',
  'ROMANCE',
  'SCI_FI',
  'THRILLER',
];

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
      title: { type: Sequelize.STRING(200), allowNull: false },
      synopsis: { type: Sequelize.TEXT, allowNull: true },
      genre: { type: Sequelize.ENUM(...GENRES), allowNull: false },
      release_year: { type: Sequelize.SMALLINT, allowNull: false },
      duration_minutes: { type: Sequelize.SMALLINT, allowNull: false },
      rating: { type: Sequelize.DECIMAL(3, 1), allowNull: false, defaultValue: 0 },
      poster_url: { type: Sequelize.STRING(2048), allowNull: true },
      is_published: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
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

    await queryInterface.addIndex(TABLE, ['title'], { name: 'movies_title_idx' });
    await queryInterface.addIndex(TABLE, ['genre'], { name: 'movies_genre_idx' });
    await queryInterface.addIndex(TABLE, ['release_year'], { name: 'movies_release_year_idx' });
    // Partial index: list endpoints almost always filter out soft-deleted rows.
    await queryInterface.addIndex(TABLE, ['is_published'], {
      name: 'movies_published_idx',
      where: { deleted_at: null },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable(TABLE);
    // Postgres keeps the enum type behind after dropTable; remove it explicitly
    // or re-running `up` fails with "type already exists".
    await queryInterface.sequelize.query(`DROP TYPE IF EXISTS "${GENRE_ENUM}";`);
  },
};
