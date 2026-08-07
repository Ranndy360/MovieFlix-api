import { type INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/sequelize';
import { Test, type TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request, { type Test as SupertestTest } from 'supertest';
import type { Server } from 'node:http';
import type { Sequelize } from 'sequelize-typescript';

import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { MovieGenre } from '../src/modules/movies/entities/movie.entity';

/**
 * Exercises the two business rules against a REAL Postgres, which is the only
 * place the partial unique index and the CHECK constraint actually run.
 *
 *   npm run db:up && NODE_ENV=test npm run db:migrate && npm run db:seed
 *   npm run test:e2e
 */
describe('Watchlist & Reviews (e2e)', () => {
  let app: INestApplication;
  let sequelize: Sequelize;
  let cookies: string[] = [];
  let movieId: string;
  let otherMovieId: string;

  const http = (): Server => app.getHttpServer() as Server;

  const credentials = {
    email: `e2e-${Date.now()}@movieflix.test`,
    password: 'E2e!Testing#2026',
    firstName: 'End',
    lastName: 'ToEnd',
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api', { exclude: ['health', 'health/liveness', 'health/readiness'] });
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());

    await app.init();
    sequelize = app.get<Sequelize>(getConnectionToken());

    const registered = await request(http())
      .post('/api/v1/auth/register')
      .send(credentials)
      .expect(201);

    cookies = registered.get('Set-Cookie') ?? [];

    const [movieA, movieB] = await Promise.all([
      sequelize.getQueryInterface().bulkInsert(
        'movies',
        [
          {
            title: `E2E Movie A ${Date.now()}`,
            genre: MovieGenre.Drama,
            release_year: 2024,
            duration_minutes: 100,
            rating: 0,
            is_published: true,
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
        { returning: ['id'] } as never,
      ),
      sequelize.getQueryInterface().bulkInsert(
        'movies',
        [
          {
            title: `E2E Movie B ${Date.now()}`,
            genre: MovieGenre.Comedy,
            release_year: 2023,
            duration_minutes: 95,
            rating: 0,
            is_published: true,
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
        { returning: ['id'] } as never,
      ),
    ]);

    movieId = (movieA as unknown as { id: string }[])[0].id;
    otherMovieId = (movieB as unknown as { id: string }[])[0].id;
  });

  afterAll(async () => {
    if (sequelize) {
      await sequelize.query('DELETE FROM reviews WHERE movie_id IN (:ids)', {
        replacements: { ids: [movieId, otherMovieId] },
      });
      await sequelize.query('DELETE FROM watchlist_entries WHERE movie_id IN (:ids)', {
        replacements: { ids: [movieId, otherMovieId] },
      });
      await sequelize.query('DELETE FROM movies WHERE id IN (:ids)', {
        replacements: { ids: [movieId, otherMovieId] },
      });
      await sequelize.query('DELETE FROM users WHERE email = :email', {
        replacements: { email: credentials.email },
      });
    }
    await app?.close();
  });

  const authed = (method: 'get' | 'post' | 'delete', url: string): SupertestTest =>
    request(http())[method](url).set('Cookie', cookies);

  it('rejects a review before the movie is marked watched', async () => {
    await authed('post', '/api/v1/reviews')
      .send({ movieId, rating: 5 })
      .expect(422)
      .expect((res) =>
        expect((res.body as { message: string }).message).toMatch(/marked as watched/i),
      );
  });

  it('adds the movie to the watchlist as WANT by default', async () => {
    const res = await authed('post', '/api/v1/watchlist').send({ movieId }).expect(201);

    expect(res.body).toMatchObject({ status: 'WANT', watchedAt: null });
  });

  it('refuses a duplicate watchlist entry', async () => {
    await authed('post', '/api/v1/watchlist').send({ movieId }).expect(409);
  });

  it('still refuses a review while the status is WANT', async () => {
    await authed('post', '/api/v1/reviews').send({ movieId, rating: 5 }).expect(422);
  });

  it('marks the movie watched and stamps watchedAt', async () => {
    const res = await authed('post', `/api/v1/watchlist/${movieId}`)
      .send({ status: 'WATCHED' })
      .expect(200);

    expect(res.body).toMatchObject({ status: 'WATCHED' });
    expect((res.body as { watchedAt: string }).watchedAt).not.toBeNull();
  });

  it('accepts the review once the movie is watched', async () => {
    const res = await authed('post', '/api/v1/reviews')
      .send({ movieId, rating: 4, comment: 'Solid.' })
      .expect(201);

    expect(res.body).toMatchObject({ rating: 4, movieId });
  });

  it('refuses a second review of the same movie', async () => {
    await authed('post', '/api/v1/reviews').send({ movieId, rating: 2 }).expect(409);
  });

  it.each([0, 6, -1, 3.5])('rejects rating %p', async (rating) => {
    await authed('post', '/api/v1/reviews').send({ movieId: otherMovieId, rating }).expect(400);
  });

  it('rejects an unknown property on the payload', async () => {
    await authed('post', '/api/v1/reviews')
      .send({ movieId: otherMovieId, rating: 3, isFeatured: true })
      .expect(400);
  });

  it('edits my own review', async () => {
    const mine = await authed('get', '/api/v1/reviews/me').expect(200);
    const reviewId = (mine.body as { items: { id: string }[] }).items[0].id;

    await authed('post', `/api/v1/reviews/${reviewId}`)
      .send({ rating: 5 })
      .expect(200)
      .expect((res) => expect((res.body as { rating: number }).rating).toBe(5));
  });

  it('reports personal stats', async () => {
    const res = await authed('get', '/api/v1/profile/stats').expect(200);

    expect(res.body).toMatchObject({
      totalWatched: 1,
      totalReviews: 1,
      averageRatingGiven: 5,
      watchlist: { want: 0, watching: 0, watched: 1, total: 1 },
    });
  });

  it('frees the slot after deleting a review', async () => {
    const mine = await authed('get', '/api/v1/reviews/me').expect(200);
    const reviewId = (mine.body as { items: { id: string }[] }).items[0].id;

    await authed('delete', `/api/v1/reviews/${reviewId}`).expect(204);
    // The unique index is partial on `deleted_at IS NULL`, so this must succeed.
    await authed('post', '/api/v1/reviews').send({ movieId, rating: 3 }).expect(201);
  });

  it('requires authentication for every watchlist route', async () => {
    await request(http()).get('/api/v1/watchlist').expect(401);
    await request(http()).post('/api/v1/watchlist').send({ movieId }).expect(401);
  });

  it('requires a session to read reviews', async () => {
    // ReviewResponseDto embeds the full movie, so a public listing would leak
    // the private catalog.
    await request(http()).get('/api/v1/reviews').query({ movieId }).expect(401);
  });

  it('serves reviews to a signed-in user', async () => {
    await authed('get', '/api/v1/reviews').query({ movieId }).expect(200);
  });
});
