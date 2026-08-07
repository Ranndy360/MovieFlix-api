import { faker } from '@faker-js/faker';

import { defineFactory } from '../../../testing/factory';
import { type CreateMovieDto } from '../dto/create-movie.dto';
import { type MovieResponseDto } from '../dto/movie-response.dto';
import { type Movie, MovieGenre, type MovieAttributes } from '../entities/movie.entity';

const randomGenre = (): MovieGenre => faker.helpers.arrayElement(Object.values(MovieGenre));

/** Plain, fully-populated row shape — the base every other factory builds on. */
export const movieAttributesFactory = defineFactory<MovieAttributes>(() => {
  const createdAt = faker.date.past({ years: 2 });

  return {
    id: faker.string.uuid(),
    createdById: null,
    title: faker.music.songName(),
    synopsis: faker.lorem.paragraph(),
    genre: randomGenre(),
    releaseYear: faker.number.int({ min: 1950, max: 2026 }),
    durationMinutes: faker.number.int({ min: 70, max: 210 }),
    rating: Number(faker.number.float({ min: 0, max: 10, fractionDigits: 1 }).toFixed(1)),
    posterUrl: faker.image.urlLoremFlickr({ category: 'cinema' }),
    isPublished: faker.datatype.boolean(),
    createdAt,
    updatedAt: faker.date.between({ from: createdAt, to: new Date() }),
    deletedAt: null,
  };
});

/**
 * A `Movie` **test double**, not a real Sequelize instance: it carries the row
 * data plus jest-mocked `update` / `destroy` so service specs can assert that
 * instance methods were called without a live connection.
 */
export interface MovieStub extends MovieAttributes {
  update: jest.Mock;
  destroy: jest.Mock;
  get: jest.Mock;
  toJSON: jest.Mock;
}

export const buildMovieStub = (overrides: Partial<MovieAttributes> = {}): MovieStub => {
  const attributes = movieAttributesFactory.build(overrides);

  const stub: MovieStub = {
    ...attributes,
    update: jest.fn(),
    destroy: jest.fn().mockResolvedValue(undefined),
    get: jest.fn(() => attributes),
    toJSON: jest.fn(() => attributes),
  };

  // Default behaviour: `update` returns the same stub with the patch applied,
  // mirroring how a real instance mutates itself in place.
  stub.update.mockImplementation((patch: Partial<MovieAttributes>) => {
    Object.assign(stub, patch);
    return Promise.resolve(stub);
  });

  return stub;
};

export const buildMovieStubs = (
  count: number,
  overrides: Partial<MovieAttributes> = {},
): MovieStub[] => Array.from({ length: count }, () => buildMovieStub(overrides));

/** Cast helper: hands a `MovieStub` to code that is typed against `Movie`. */
export const asMovie = (stub: MovieStub): Movie => stub as unknown as Movie;

/** Valid `POST /movies` payload. */
export const createMovieDtoFactory = defineFactory<CreateMovieDto>(() => ({
  title: faker.music.songName(),
  synopsis: faker.lorem.sentences(2),
  genre: randomGenre(),
  releaseYear: faker.number.int({ min: 1950, max: 2026 }),
  durationMinutes: faker.number.int({ min: 70, max: 210 }),
  rating: Number(faker.number.float({ min: 0, max: 10, fractionDigits: 1 }).toFixed(1)),
  posterUrl: faker.internet.url(),
  isPublished: true,
}));

/** Expected wire shape, for controller-level assertions. */
export const movieResponseFactory = defineFactory<MovieResponseDto>(() => {
  const { deletedAt: _deletedAt, ...rest } = movieAttributesFactory.build();
  return rest;
});
