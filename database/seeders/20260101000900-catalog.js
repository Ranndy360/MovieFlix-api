'use strict';

const TABLE = 'movies';

/**
 * A demo catalog big enough for the UI to look like a real product: several
 * titles in each genre, so every carousel row has something to scroll.
 *
 * Artwork uses picsum.photos with a deterministic seed — real images over the
 * network, without shipping copyrighted posters. The host is allow-listed in
 * the frontend's `next.config.ts`. Titles with `poster: false` deliberately
 * have none, to exercise the generated-gradient fallback.
 *
 * Safe to delete: nothing outside this file depends on these rows.
 */
const slug = (title) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const MOVIES = [
  ['Blade Runner 2049', 'SCI_FI', 2017, 164, 8.0, 'A young blade runner uncovers a secret capable of tipping society into chaos.'],
  ['Arrival', 'SCI_FI', 2016, 116, 7.9, 'A linguist is recruited to find out why twelve alien craft have appeared on Earth.'],
  ['Interstellar', 'SCI_FI', 2014, 169, 8.7, 'Explorers travel through a wormhole in search of a new home for humanity.'],
  ['Ex Machina', 'SCI_FI', 2014, 108, 7.7, 'A programmer is invited to administer the Turing test to an intelligent humanoid.'],
  ['Dune', 'SCI_FI', 2021, 155, 8.0, 'A noble family becomes embroiled in a war over the galaxy’s most valuable asset.'],

  ['Mad Max: Fury Road', 'ACTION', 2015, 120, 8.1, 'In a desert wasteland, two rebels flee a tyrant across a relentless chase.'],
  ['John Wick', 'ACTION', 2014, 101, 7.4, 'A retired hitman is pulled back in after thieves take everything he has left.'],
  ['Heat', 'ACTION', 1995, 170, 8.3, 'A detective and a career thief circle one another across Los Angeles.'],
  ['The Raid', 'ACTION', 2011, 101, 7.6, 'A SWAT team is trapped in a tower block ruled by a ruthless crime lord.'],

  ['Hereditary', 'HORROR', 2018, 127, 7.3, 'A grieving family unravels a chain of cryptic and increasingly terrifying secrets.'],
  ['The Witch', 'HORROR', 2015, 92, 7.0, 'A Puritan family is torn apart by forces beyond the edge of their farmland.'],
  ['Get Out', 'HORROR', 2017, 104, 7.8, 'A weekend with his girlfriend’s family turns into a nightmare he cannot name.'],

  ['The Grand Budapest Hotel', 'COMEDY', 2014, 99, 8.1, 'A concierge and his protege are caught up in the theft of a priceless painting.'],
  ['Superbad', 'COMEDY', 2007, 113, 7.6, 'Two co-dependent friends attempt to make the most of one last night.'],
  ['The Nice Guys', 'COMEDY', 2016, 116, 7.4, 'A mismatched pair investigate a missing girl in 1970s Los Angeles.'],

  ['Parasite', 'DRAMA', 2019, 132, 8.5, 'Greed and class discrimination threaten a newly formed symbiotic relationship.'],
  ['The Shawshank Redemption', 'DRAMA', 1994, 142, 9.3, 'Two imprisoned men bond over years, finding solace and eventual redemption.'],
  ['Whiplash', 'DRAMA', 2014, 106, 8.5, 'A young drummer enrols under an instructor who will stop at nothing.'],
  ['Nomadland', 'DRAMA', 2020, 107, 7.3, 'A woman in her sixties travels the American West living as a modern nomad.'],

  ['Se7en', 'THRILLER', 1995, 127, 8.6, 'Two detectives hunt a killer who uses the seven deadly sins as his motive.'],
  ['Prisoners', 'THRILLER', 2013, 153, 8.1, 'A father takes matters into his own hands when his daughter goes missing.'],
  ['Gone Girl', 'THRILLER', 2014, 149, 8.1, 'A husband becomes the prime suspect in his wife’s sudden disappearance.'],

  ['Spirited Away', 'ANIMATION', 2001, 125, 8.6, 'A girl wanders into a world of spirits and must work to free her parents.'],
  ['Spider-Man: Into the Spider-Verse', 'ANIMATION', 2018, 117, 8.4, 'Teen Miles Morales becomes Spider-Man and joins others from parallel worlds.'],
  ['Your Name.', 'ANIMATION', 2016, 106, 8.4, 'Two teenagers discover they are inexplicably swapping bodies.'],

  ['Indiana Jones and the Raiders of the Lost Ark', 'ADVENTURE', 1981, 115, 8.4, 'An archaeologist races the Nazis to find the Ark of the Covenant.'],
  ['The Lord of the Rings: The Fellowship of the Ring', 'ADVENTURE', 2001, 178, 8.9, 'A hobbit sets out to destroy a ring that would let a dark lord rule all.'],

  ['Before Sunrise', 'ROMANCE', 1995, 101, 8.1, 'Two strangers meet on a train and spend one night walking through Vienna.'],
  ['Eternal Sunshine of the Spotless Mind', 'ROMANCE', 2004, 108, 8.3, 'A couple erase each other from their memories and find their way back.'],

  ['Free Solo', 'DOCUMENTARY', 2018, 100, 8.1, 'Alex Honnold attempts the first free solo climb of El Capitan.'],
  ['My Octopus Filmmaker', 'DOCUMENTARY', 2020, 85, 8.1, 'A filmmaker forms an unlikely bond with an octopus in a kelp forest.'],
];

/** A couple of entries with no artwork, to exercise the fallback tile. */
const WITHOUT_POSTER = new Set(['My Octopus Filmmaker', 'Before Sunrise']);

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const now = new Date();

    const [existing] = await queryInterface.sequelize.query(`SELECT title FROM "${TABLE}";`);
    const present = new Set(existing.map((row) => row.title));

    const rows = MOVIES.filter(([title]) => !present.has(title)).map(
      ([title, genre, year, minutes, rating, synopsis]) => ({
        title,
        synopsis,
        genre,
        release_year: year,
        duration_minutes: minutes,
        rating,
        poster_url: WITHOUT_POSTER.has(title)
          ? null
          : `https://picsum.photos/seed/${slug(title)}/400/600`,
        is_published: true,
        created_at: now,
        updated_at: now,
        deleted_at: null,
      }),
    );

    if (rows.length === 0) return;

    await queryInterface.bulkInsert(TABLE, rows);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete(TABLE, {
      title: { [Sequelize.Op.in]: MOVIES.map(([title]) => title) },
    });
  },
};
