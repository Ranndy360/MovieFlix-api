import { type INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { Server } from 'node:http';

import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { MovieGenre } from '../src/modules/movies/entities/movie.entity';

/**
 * End-to-end coverage runs against a REAL Postgres (`movieflix_test`).
 *
 *   npm run db:up
 *   NODE_ENV=test npm run db:migrate
 *   npm run test:e2e
 *
 * Unit specs never touch the database — see src/**\/*.spec.ts.
 */
describe('Movies (e2e)', () => {
  let app: INestApplication;
  /** Catalog writes require ADMIN or PROVIDER — see movies.controller.ts. */
  let adminCookies: string[] = [];

  /** `getHttpServer()` returns `any`, which defeats supertest's typings. */
  const http = (): Server => app.getHttpServer() as Server;

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

    const signedIn = await request(http())
      .post('/api/v1/auth/login')
      .send({
        email: process.env.SEED_ADMIN_EMAIL ?? 'admin@movieflix.test',
        password: process.env.SEED_ADMIN_PASSWORD ?? 'Admin123!Change',
      })
      .expect(200);

    adminCookies = signedIn.get('Set-Cookie') ?? [];
  });

  afterAll(async () => {
    await app?.close();
  });

  const payload = {
    title: 'E2E Test Movie',
    synopsis: 'Created by the end-to-end suite.',
    genre: MovieGenre.Drama,
    releaseYear: 2024,
    durationMinutes: 120,
    rating: 7.5,
    isPublished: true,
  };

  it('rejects an invalid payload with 400', async () => {
    await request(http())
      .post('/api/v1/movies')
      .set('Cookie', adminCookies)
      .send({ ...payload, releaseYear: 1200 })
      .expect(400);
  });

  it('rejects unknown properties', async () => {
    await request(http())
      .post('/api/v1/movies')
      .set('Cookie', adminCookies)
      .send({ ...payload, sneaky: 'value' })
      .expect(400);
  });

  it('creates, reads, updates and deletes a movie', async () => {
    const created = await request(http())
      .post('/api/v1/movies')
      .set('Cookie', adminCookies)
      .send(payload)
      .expect(201);

    const { id } = created.body as { id: string };
    expect(id).toBeDefined();
    expect(created.body).toMatchObject({ title: payload.title, rating: 7.5 });

    await request(http()).get(`/api/v1/movies/${id}`).set('Cookie', adminCookies).expect(200);

    const list = await request(http())
      .get('/api/v1/movies')
      .set('Cookie', adminCookies)
      .query({ search: 'E2E', pageSize: 10 })
      .expect(200);
    expect((list.body as { items: unknown[] }).items.length).toBeGreaterThan(0);

    await request(http())
      .post(`/api/v1/movies/${id}`)
      .set('Cookie', adminCookies)
      .send({ title: 'Renamed by e2e' })
      .expect(200)
      .expect((res) => expect((res.body as { title: string }).title).toBe('Renamed by e2e'));

    await request(http()).delete(`/api/v1/movies/${id}`).set('Cookie', adminCookies).expect(204);
    await request(http()).get(`/api/v1/movies/${id}`).set('Cookie', adminCookies).expect(404);
  });

  it('returns 400 for a malformed uuid', async () => {
    await request(http()).get('/api/v1/movies/not-a-uuid').set('Cookie', adminCookies).expect(400);
  });

  it('keeps the whole catalog behind a session', async () => {
    // Protecting only the frontend route would be cosmetic — this is the
    // boundary that actually holds.
    await request(http()).get('/api/v1/movies').expect(401);
    await request(http()).get('/api/v1/movies/00000000-0000-4000-8000-000000000000').expect(401);
    await request(http()).post('/api/v1/movies').send(payload).expect(401);
  });

  it('serves the catalog to any signed-in user', async () => {
    await request(http()).get('/api/v1/movies').set('Cookie', adminCookies).expect(200);
  });

  it('exposes an unversioned readiness probe', async () => {
    await request(http()).get('/health/readiness').expect(200);
  });
});
