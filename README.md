# MovieFlix-api

MovieFlix is the API NestJS project to manage movies like Netflix.

**Stack:** NestJS 11 · TypeScript (strict) · PostgreSQL 16 · Sequelize v6 +
`sequelize-typescript` · Swagger/OpenAPI · Jest + faker.

## Quick start

```bash
npm install
cp .env.example .env          # already provided with working local values

npm run db:up                 # postgres 16 in docker on :5432
npm run db:migrate            # create the schema
npm run db:seed               # optional demo rows

npm run start:dev
```

| URL | What |
| --- | --- |
| `http://localhost:3001/api/v1` | API base |
| `http://localhost:3001/docs` | Swagger UI |
| `http://localhost:3001/docs-json` | OpenAPI JSON (codegen source) |
| `http://localhost:3001/health/readiness` | Readiness probe |

### Seeded accounts

`npm run db:seed` creates the roles and one account each. Local defaults —
change them anywhere that is not your laptop (`SEED_*` in `.env`).

| Role | Email | Password |
| --- | --- | --- |
| ADMIN | `admin@movieflix.test` | `Admin123!Change` |
| PROVIDER | `provider@movieflix.test` | `Provider123!Change` |
| USER | `user@movieflix.test` | `User123!Change` |

Self-service signup **always** creates a `USER`. ADMIN and PROVIDER are granted
only by the seeder or an existing admin via `PATCH /users/:id/role`.

### Endpoints

| Endpoint | Who |
| --- | --- |
| `POST /auth/register`, `/auth/login`, `/auth/refresh` | anonymous |
| `GET /auth/me`, `POST /auth/logout`, `/auth/logout-all` | signed in |
| `GET /movies`, `GET /movies/:id` | signed in — the catalog is private |
| `POST /movies` | ADMIN, PROVIDER — JSON, or multipart with a `poster` file |
| `PATCH /movies/:id` | ADMIN, PROVIDER |
| `DELETE /movies/:id` | ADMIN |
| `POST /watchlist` | signed in — add a movie to my list |
| `GET /watchlist` | signed in — my full list, paginated, `?status=` |
| `PATCH /watchlist/:movieId` | signed in — change its status |
| `DELETE /watchlist/:movieId` | signed in — remove it |
| `POST /reviews` | signed in — leave a review (rating 1–5) |
| `GET /reviews` | signed in — reviews, `?movieId=` |
| `GET /reviews/me` | signed in — my reviews |
| `PATCH /reviews/:id`, `DELETE /reviews/:id` | signed in — my review only |
| `GET /profile/stats` | signed in — total watched, average rating given |
| `/users/**` | ADMIN |

Watchlist entries are addressed by `movieId`: `(user, movie)` is unique, so the
client already holds everything needed to name the resource.

### Uploading a poster

`POST /movies` takes `multipart/form-data` with an optional `poster` image
(JPEG, PNG, WebP, AVIF — max 10MB on upload). It is stored in Supabase Storage under
`<NODE_ENV>/movies/<uuid>.<ext>`, so environments never collide in one bucket,
and the public URL is saved as `posterUrl`.

```bash
curl -b cookies.txt -X POST http://localhost:3001/api/v1/movies \
  -F 'title=Dune' -F 'genre=SCI_FI' -F 'releaseYear=2021' \
  -F 'durationMinutes=155' -F 'poster=@dune.jpg'
```

Uploads are optimised before storage: auto-rotated, resized into 1280×1920,
stripped of metadata and re-encoded to WebP at q82. Real numbers: a 3.0MB JPEG
is stored as 514KB (−84%), a 9.2MB one as 577KB (−94%) — visually the same.
Tune with `IMAGE_TARGET_FORMAT`, `IMAGE_QUALITY`, `IMAGE_MAX_WIDTH/HEIGHT`.

Files are validated by their **magic bytes**, not the declared content type.
Without `SUPABASE_URL` and `SUPABASE_SECRET_KEY` the API runs fine and only
uploads return 503 — sending `posterUrl` as a plain JSON field still works.

### Business rules

- **A review requires the movie to be marked `WATCHED`** on the caller's
  watchlist — otherwise `422`.
- **One review per user per movie** — a second attempt is `409`. Deleting a
  review frees the slot (the unique index is partial on `deleted_at IS NULL`).

Both are enforced in the service *and* by database constraints, so a race
between two concurrent requests cannot slip through.

### Without Docker

Point `DB_*` in `.env` at any Postgres 16 instance and create the databases:

```bash
createdb movieflix && createdb movieflix_test
npm run db:migrate
```

## Scripts

```bash
npm run start:dev      # watch mode
npm run build          # compile to dist/
npm run start:prod     # run the build

npm test               # unit tests
npm run test:cov       # unit tests + coverage (thresholds enforced)
npm run test:e2e       # e2e against movieflix_test — needs a live database

npm run lint           # eslint (flat config) + prettier
npm run typecheck      # tsc --noEmit

npm run db:migrate         # apply migrations
npm run db:migrate:undo    # roll back the last one
npm run db:migrate:status
npm run db:seed
npm run db:migration:create -- add-something
```

## Layout

```
src/
├── config/      env validation + typed config namespaces + swagger
├── common/      filters, interceptors, shared DTOs, decorators
├── database/    sequelize root connection & model registry
├── health/      liveness / readiness probes
├── testing/     factory base + model mocks
└── modules/     feature modules (movies/ is the reference implementation)
database/        sequelize-cli config, migrations, seeders
test/            e2e specs
```

`modules/movies/` is a complete reference vertical slice — entity, migration,
DTOs, service, controller, factory and specs. Copy its shape for new features,
or delete it once real domains exist.

## Environment

Every variable is declared in `src/config/env.validation.ts`; the process
refuses to boot on a missing or malformed value. See `.env.example` for the
full annotated list. `.env` (development) and `.env.test` (e2e) ship with
working local defaults.

## Conventions

See [CLAUDE.md](CLAUDE.md) for the full engineering guide: layering rules,
Sequelize/migration policy, DTO contracts, error handling and the
factory-based testing approach.
