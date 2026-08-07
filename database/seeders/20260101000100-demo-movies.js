'use strict';

const TABLE = 'movies';

const now = new Date();

const MOVIES = [
  {
    title: 'Blade Runner 2049',
    synopsis: 'A young blade runner uncovers a secret that could tip society into chaos.',
    genre: 'SCI_FI',
    release_year: 2017,
    duration_minutes: 164,
    rating: 8.0,
    is_published: true,
  },
  {
    title: 'Arrival',
    synopsis: 'A linguist is recruited to communicate with extraterrestrial visitors.',
    genre: 'SCI_FI',
    release_year: 2016,
    duration_minutes: 116,
    rating: 7.9,
    is_published: true,
  },
  {
    title: 'The Grand Budapest Hotel',
    synopsis: 'A concierge and his protégé are caught up in the theft of a painting.',
    genre: 'COMEDY',
    release_year: 2014,
    duration_minutes: 99,
    rating: 8.1,
    is_published: true,
  },
  {
    title: 'Hereditary',
    synopsis: 'A grieving family unravels cryptic and terrifying secrets.',
    genre: 'HORROR',
    release_year: 2018,
    duration_minutes: 127,
    rating: 7.3,
    is_published: false,
  },
];

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.bulkInsert(
      TABLE,
      MOVIES.map((movie) => ({
        ...movie,
        poster_url: null,
        created_at: now,
        updated_at: now,
        deleted_at: null,
      })),
    );
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete(TABLE, {
      title: { [Sequelize.Op.in]: MOVIES.map((movie) => movie.title) },
    });
  },
};
