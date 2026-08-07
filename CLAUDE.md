# CLAUDE.md — MovieFlix API

Guidance for Claude Code (and humans) working in this repository.

## What this service is

MovieFlix's backend: a NestJS HTTP API over PostgreSQL that owns the movie
catalog. It is consumed by the `MovieFlix` Next.js frontend (sibling directory).

**Stack:** NestJS 11 · TypeScript (full `strict`) · PostgreSQL 16 ·
Sequelize v6 + `sequelize-typescript` · Swagger/OpenAPI · Jest + `@faker-js/faker`.

## Commands

| Task | Command |
| --- | --- |
| Install | `npm install` |
| Start Postgres | `npm run db:up` (Docker) |
| Run migrations | `npm run db:migrate` |
| Seed demo data | `npm run db:seed` |
| Dev server | `npm run start:dev` |
| Unit tests | `npm test` / `npm run test:cov` |
| E2E tests | `npm run test:e2e` (needs a live `movieflix_test` DB) |
| Lint | `npm run lint` / `npm run lint:fix` |
| Typecheck | `npm run typecheck` |
| Build | `npm run build` |

**Before declaring any change done, run:** `npm run lint && npm run typecheck && npm test`.

- API base URL: `http://localhost:3001/api/v1`
- Swagger UI: `http://localhost:3001/docs` — raw contract at `/docs-json`
- Probes: `http://localhost:3001/health/liveness` and `/health/readiness` (unversioned by design)

## Directory layout

```
src/
├── main.ts                     # bootstrap: security, pipes, filters, versioning, swagger
├── app.module.ts               # composition root — register feature modules here
├── config/
│   ├── env.validation.ts       # THE list of supported env vars; boot fails if invalid
│   ├── configuration.ts        # typed `registerAs` namespaces: app / database / swagger
│   └── swagger.setup.ts
├── common/                     # cross-cutting only; never imports from modules/
│   ├── decorators/  dto/  filters/  interceptors/
├── database/database.module.ts # Sequelize root connection + MODELS registry
├── health/                     # terminus probes
├── testing/                    # factory base + model mocks (test-only helpers)
└── modules/<feature>/          # one folder per bounded context
    ├── dto/                    # request + response contracts
    ├── entities/               # Sequelize models
    ├── testing/                # <feature>.factory.ts
    ├── <feature>.controller.ts # HTTP only
    ├── <feature>.service.ts    # business logic
    └── <feature>.module.ts

Feature modules:
  movies/     global catalog (public reads, ADMIN/PROVIDER writes)
  watchlist/  the caller's personal list
  reviews/    ratings and comments; owns the two business rules
  profile/    read-only stats composed from watchlist + reviews
  users/      admin user administration
  auth/       registration, login, sessions
database/                       # sequelize-cli territory (plain JS, outside TS build)
├── config.js  migrations/  seeders/
```

## Non-negotiable conventions

### Layering

`Controller → Service → Model`. Strictly one direction.

- **Controllers** parse/validate input, call exactly one service method, return
  its result. No business logic, no Sequelize imports, no `try/catch` for
  error shaping — the global filter does that.
- **Services** hold the logic and own all persistence. They accept DTOs and
  return **response DTOs**, never entities.
- **Entities never cross the HTTP boundary.** Always map through
  `XResponseDto.fromEntity()`. Returning a model leaks every column added
  later plus Sequelize internals.
- `common/` must never import from `modules/`. The dependency arrow points one way.

### TypeScript

- `strict` is fully on, plus `noUnusedLocals`, `noImplicitReturns`,
  `noImplicitOverride`, `noUnusedParameters`. Do not relax `tsconfig.json` to
  make an error go away — fix the type.
- **`useDefineForClassFields` must stay `false`.** Decorator libraries
  (`sequelize-typescript`, `class-validator`) break when class fields are
  emitted with `[[Define]]` semantics.
- `any` is a lint error in `src/`. Use `unknown` + a narrowing check.
- Prefer `import type` for type-only imports (enforced by lint).
- Every exported function needs an explicit return type.

### DTOs and validation

- One DTO per direction: `CreateXDto`, `UpdateXDto` (= `PartialType(CreateXDto)`
  from **`@nestjs/swagger`**, not `@nestjs/mapped-types`), `QueryXDto`, `XResponseDto`.
- Every DTO field carries both a `class-validator` decorator **and** an
  `@ApiProperty`/`@ApiPropertyOptional`. A field with no validator is a hole:
  the global pipe runs with `forbidNonWhitelisted: true`, so undecorated
  properties are silently stripped or rejected.
- Model fields use `!` (definite assignment), never initializers — an initializer
  would shadow the Sequelize getter.
- List endpoints extend `PaginationQueryDto`. Never re-invent `page`/`pageSize`.

### Sequelize

- **Migrations are the only way schema changes.** `DB_SYNCHRONIZE` exists for
  local scratch work and is force-disabled outside `development`. Every entity
  change needs a matching migration in `database/migrations/`.
- Create migrations with `npm run db:migration:create -- describe-the-change`.
  Always implement a working `down`. For Postgres enums, `down` must
  `DROP TYPE` explicitly — `dropTable` leaves the type behind and re-running
  `up` then fails.
- Register new models in `MODELS` in `src/database/database.module.ts` **and**
  in the feature module's `SequelizeModule.forFeature([...])`.
- The connection runs `underscored: true`: TS `releaseYear` ↔ column
  `release_year`. Keep `field:` explicit on models so both sides are readable.
- `DECIMAL` comes back from `pg` as a **string**. Columns like `rating` define a
  getter that parses it — do that for every new decimal column.
- Soft deletes: `paranoid: true` + a `deleted_at` column. `destroy()` then sets
  the timestamp instead of deleting the row.
- Index anything you filter or sort by. Partial indexes (`where: { deleted_at: null }`)
  are usually the right call on a paranoid table.
- Multi-write operations must run in a transaction (`sequelize.transaction()`),
  passed through as `{ transaction }` on every call inside it.

### Errors

- Throw Nest's HTTP exceptions (`NotFoundException`, `ConflictException`, …) from
  services. `AllExceptionsFilter` normalizes everything into one body shape.
- Never let a raw Sequelize error reach the client — the filter maps
  `UniqueConstraintError` → 409 and other DB errors → 422 with a generic
  message, so SQL and connection strings never leak.
- Put the 404 for "entity missing" behind a single private
  `findEntityOrFail()` per service so every endpoint reports it identically.

### Configuration

- Adding an env var means editing **three** places: `env.validation.ts` (the
  contract), `configuration.ts` (the typed accessor), and `.env.example`
  (the documentation). Missing any one of these is a bug.
- Read config via `configService.getOrThrow<T>('namespace')`, never
  `process.env` directly outside `config/`.
- Secrets never get committed. `.env` is gitignored; `.env.example` holds
  placeholder values only.

## Domain model

```
User ──< WatchlistEntry >── Movie        (status: WANT | WATCHING | WATCHED)
User ──< Review          >── Movie        (rating 1–5, one per user per movie)
```

`Movie` is a **global catalog** owned by ADMIN/PROVIDER. `WatchlistEntry` and
`Review` are personal: every route derives the owner from the access token, so
no user id ever appears in a path or body and one user can never read or write
another's rows.

### Module dependencies

```
ProfileModule ──> WatchlistModule
      └────────> ReviewsModule ──> WatchlistModule
```

One direction only. `ReviewsService` asks `WatchlistService.hasWatched()`;
`WatchlistService` knows nothing about reviews. Keep it that way — the reverse
edge would need `forwardRef` and make both modules untestable in isolation.
`ProfileService` owns no tables and composes what the other two expose.

### The two business rules

| Rule | Enforced where |
| --- | --- |
| Only review a movie marked `WATCHED` | `ReviewsService.create` → `WatchlistService.hasWatched()`; **422** |
| One review per user per movie | Partial unique index `reviews_user_movie_key`; **409** |

Both are enforced in the **database as well as the service**:

- `reviews_user_movie_key` is `UNIQUE (user_id, movie_id) WHERE deleted_at IS NULL`.
  Partial, so deleting a review frees the slot instead of blocking it forever.
- `reviews_rating_range` is a `CHECK (rating BETWEEN 1 AND 5)`.
- `watchlist_entries_user_movie_key` is `UNIQUE (user_id, movie_id)`.

The services catch `UniqueConstraintError` and translate it rather than relying
on a prior `SELECT`: two concurrent requests can both pass an application-level
check, and only the index actually prevents the duplicate.

**422 vs 403 for the watched rule.** The caller is entitled to review — nothing
about *them* is wrong. It is the state of their watchlist that makes the request
impossible, which is what 422 means. 403 would suggest a permission problem.

**Status changes do not cascade.** Moving a movie off `WATCHED` leaves an
existing review in place; it is only *creating* a review that requires the
watched state. Enforcing it in reverse would mean `WatchlistModule` importing
`ReviewsModule` and a dependency cycle. If the product ever needs reviews
retracted on un-watch, do it with a domain event, not a back-edge.

## Object storage (Supabase)

`POST /movies` accepts **either** `application/json` **or**
`multipart/form-data` with a `poster` file. `FileInterceptor` wraps multer,
which ignores non-multipart requests, so JSON clients are unaffected.

### Object keys

```
<NODE_ENV>/<folder>/<uuid>.<ext>      e.g. production/movies/3f2a….jpg
```

Three deliberate choices:

- **Environment prefix** — one bucket can safely serve development, test and
  production; a stray upload is immediately visible in the wrong folder. It
  comes from `NODE_ENV`, so nothing extra needs configuring per environment.
- **UUID filename** — the client's `originalname` is discarded entirely, which
  removes path traversal, collision-overwrite and every other problem that
  comes from trusting an uploaded filename.
- **Extension from sniffed content**, never from the request.

### Optimisation (`ImageOptimizerService`)

Every upload is re-encoded with `sharp` before it reaches the bucket, so the
stored object is the one we intend to serve. Four steps, in this order:

1. **Auto-rotate** — EXIF orientation is baked into the pixels *before*
   metadata is stripped. Reverse the order and photos silently come out
   sideways.
2. **Resize into a bounding box** (`IMAGE_MAX_WIDTH` × `IMAGE_MAX_HEIGHT`,
   default 1280×1920) with `fit: inside, withoutEnlargement: true`. A small
   source is left alone rather than upscaled into blur.
3. **Strip metadata** — EXIF/ICC/thumbnails are often tens of KB and can carry
   GPS coordinates. A size win and a privacy win.
4. **Re-encode** to `IMAGE_TARGET_FORMAT` (default `webp`) at `IMAGE_QUALITY`
   (default 82 — the usual visually-lossless point; above ~90 costs bytes for
   no perceptible gain).

Measured against real uploads: **3.0MB → 514KB (−84%)** and **9.2MB → 577KB
(−94%)**, both at 1280×1920.

Two rules worth keeping:

- **Never return something bigger than the input.** An already-optimised file
  can grow when re-encoded; in that case the original is kept and
  `savedPercent` is 0.
- `UPLOAD_MAX_FILE_SIZE_MB` (default 10) is the **upload** cap, not the stored
  size. Phone photos are routinely 5-9MB and end up a few hundred KB, so a
  tight cap here only rejects legitimate files. It exists to bound the
  per-request buffer, and multer enforces it before the body is read —
  over-limit uploads get a clean **413**.

Re-encoding is also a security control: the output is pixels decoded and
written afresh by libvips, so a payload smuggled inside the original container
does not survive.

### Validating uploads

`Content-Type` on a multipart part is client-supplied and trivially forged, so
it is never the deciding check. `image-signature.ts` reads the actual magic
bytes and only JPEG, PNG, WebP and AVIF pass. A declared type that contradicts
the content is rejected outright. **SVG is deliberately excluded** — it can
carry script and would be an XSS vector when served from our own origin.

Size is capped twice: `SINGLE_IMAGE_UPLOAD` caps it at the multer layer (before
the body is buffered — this is the one that actually protects the process), and
`StorageService` re-checks after.

### Failure handling

- Upload happens **before** the insert, and a failed insert deletes the object
  again. Without that compensation every failed create leaks a file.
- Supabase errors become **503**, never 500, and the provider's message is not
  forwarded to the caller.
- Storage is **optional**: with no `SUPABASE_URL` / `SUPABASE_SECRET_KEY` the
  API boots normally and only uploads 503. Local development needs no Supabase
  project.

### Dependency

Use `@supabase/storage-js`, **not** `@supabase/supabase-js`. The umbrella SDK
also constructs a Realtime client that requires a native WebSocket (Node 22+)
and crashes the app at boot on older runtimes. We only need Storage.

`SUPABASE_SECRET_KEY` is the service-role key: it bypasses row-level security,
so it is server-side only and must never appear behind a `NEXT_PUBLIC_` prefix.

## Authentication & authorization

JWT over `httpOnly` cookies, with refresh-token rotation. Three roles:
`ADMIN`, `PROVIDER`, `USER`.

### The model

| Piece | Where | Lifetime |
| --- | --- | --- |
| Access token | `mf_access` cookie, path `/` | `JWT_ACCESS_TTL` (15m) |
| Refresh token | `mf_refresh` cookie, path `/api/v1/auth` | `JWT_REFRESH_TTL` (30d) |
| Session record | `refresh_tokens` row (SHA-256 of the token) | until revoked or expired |

**Tokens are never in a response body.** They are `httpOnly`, so no script can
read them — the mitigation `localStorage` cannot offer, where one XSS anywhere
exfiltrates the session. The trade is CSRF, closed off by `SameSite` plus the
explicit CORS allow-list (`credentials: true` forbids a wildcard origin).

Access and refresh use **different secrets**, so a leaked access secret cannot
mint refresh tokens.

### Rules that must not be relaxed

- **Deny by default.** `JwtAuthGuard` is a global `APP_GUARD`. A new endpoint is
  protected unless it carries `@Public()`. Forgetting the decorator fails safe.
- **The catalog is private.** `GET /movies`, `GET /movies/:id` and `GET /reviews`
  all require a session. Only `/auth/{register,login,refresh}` and the health
  probes are `@Public()`. Protecting the frontend route alone would be
  cosmetic — anyone can curl the API — and `ReviewResponseDto` embeds the full
  movie, so a public review listing would leak the catalog sideways.
- **Signup is USER-only.** `RegisterDto` has no `role` field, and
  `AuthService.register` hard-codes `SIGNUP_ROLE`. With
  `forbidNonWhitelisted: true`, `{"role":"ADMIN"}` is a 400, not a silent
  ignore. ADMIN and PROVIDER come only from the seeder or an existing admin.
- **The role is read from the database on every request**, not from the token
  (`JwtStrategy.validate`). A demotion or deactivation therefore takes effect
  immediately instead of lingering until the access token expires.
- **Never return a `User` entity.** Map through `UserResponseDto`, which has no
  `passwordHash` field. `User.toJSON()` strips it too, as a second line.
- **Login discloses nothing.** Unknown email and wrong password return the
  identical 401; the unknown-email path runs `compareWithDummy` so it costs the
  same time. Do not add a "no such user" message.
- **Check the password before disclosing lock/disabled state.** The order in
  `AuthService.login` is deliberate: verifying first means "locked" is only ever
  revealed to someone who already proved they know the password, so it is not
  an account-existence oracle. Reordering these re-introduces enumeration.

### Guards and decorators

```ts
@Public()                                   // no authentication
@Roles(RoleName.Admin)                      // admins only
@Roles(RoleName.Admin, RoleName.Provider)   // either (OR)
@CurrentUser() user: AuthenticatedUser      // the principal
@CurrentUser('id') userId: string
```

`@Roles` works at class or method level; a method-level list **overrides** the
controller's rather than intersecting. Roles are a flat set, not a hierarchy —
`ADMIN` does not implicitly satisfy `@Roles(RoleName.Provider)`; list both.

Guard order (`app.module.ts`, registration order matters): `ThrottlerGuard` →
`JwtAuthGuard` → `RolesGuard`. `RolesGuard` needs `request.user`, so it must
run last.

### Brute-force defense — two independent layers

1. **Per-IP rate limit** (`@nestjs/throttler`): 10/min on login, 5/min on
   register, 30/min on refresh. Tunable via `AUTH_*_THROTTLE_LIMIT`.
2. **Per-account lockout**: `AUTH_MAX_FAILED_ATTEMPTS` (5) consecutive failures
   sets `locked_until` for `AUTH_LOCKOUT_MINUTES` (15). A correct password
   during the window returns 429 with `retryAfterSeconds`.

Both matter: rate limiting alone lets a botnet spread attempts across IPs;
lockout alone lets one IP grind a large user list.

### Session length

`JWT_REFRESH_TTL` (30d) is how long someone stays signed in; `JWT_ACCESS_TTL`
(15m) is how often the access token rotates. **Do not lengthen the access
token to extend the session** — it is the revocation window, so a deactivated
account, a demoted role or a stolen access cookie all keep working until it
expires. Rotation is silent, so a short access TTL costs the user nothing.

A month-long refresh window is only safe because it rotates on every use and
replay revokes the whole family. If that ever changes, shorten it.

### Refresh rotation and reuse detection

Each refresh consumes its token and issues a new pair. Presenting an
already-rotated token means theft or replay, so **every session for that user is
revoked**. The same happens on a token-hash mismatch. This is why the frontend
single-flights its refresh calls — concurrent rotations would look like reuse.

### Adding a protected endpoint

1. Decide the roles and add `@Roles(...)`, or `@Public()` for anonymous access.
2. `@ApiBearerAuth('access-token')` + `@ApiForbiddenResponse` so the contract
   documents it.
3. Never trust a user id from the body or query — take it from `@CurrentUser()`.
4. Test the allowed role, a denied role, and the anonymous case.

### Seeded accounts

`npm run db:seed` creates the three roles plus one account each. Credentials
come from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` (and the provider/user
equivalents) — the defaults are local-only and must be changed anywhere else.
Both seeders are idempotent.

## Testing

Jest, with a hard coverage floor (`80%` statements/lines/functions, `70%` branches).
CI fails below it.

### The rules

1. **Unit tests never touch Postgres.** Mock the model with
   `createMockModel()` from `src/testing/mock-model.ts` and provide it under
   `getModelToken(Entity)`. Unit tests assert *the query the service builds*.
2. **Real SQL is verified in `test/*.e2e-spec.ts`** against the `movieflix_test`
   database. That is the only place a live connection is allowed.
3. **Build test data with factories, never inline literals.** Every factory
   emits a complete valid object; a test overrides only the fields it asserts on.
   This is what stops a new column from breaking forty unrelated specs.

### Factories

`src/testing/factory.ts` provides `defineFactory`, `Factory#build`,
`#buildMany`, `#extend`, and `seedFaker()`. Per-feature factories live in
`src/modules/<feature>/testing/<feature>.factory.ts`.

```ts
// full, valid object
const movie = movieAttributesFactory.build();

// override only what the assertion is about
const horror = movieAttributesFactory.build({ genre: MovieGenre.Horror });

// ten of them, varied per index
const page = movieAttributesFactory.buildMany(10, (i) => ({ releaseYear: 2000 + i }));

// an instance test-double with jest-mocked update()/destroy()
const stub = buildMovieStub({ title: 'Dune' });
model.findByPk.mockResolvedValue(stub);
```

Call `seedFaker()` in `beforeEach` so a failing run is reproducible.

### Writing a spec

- One `describe` per public method; test names state the behavior
  ("throws NotFoundException naming the id"), not the implementation.
- Assert on **arguments passed to the mock**, not just the return value —
  that is how you catch a broken `where` clause.
- Always cover: the happy path, each filter/branch, the empty result, and the
  not-found path.

## Adding a feature module — checklist

1. `nest g resource modules/<name>` (or copy `modules/movies/`).
2. Entity in `entities/`, registered in `MODELS` + `SequelizeModule.forFeature`.
3. Migration in `database/migrations/` with a working `down`.
4. DTOs: create / update / query / response, all decorated for both
   `class-validator` and Swagger.
5. Service returning response DTOs; controller thin, fully `@Api*`-annotated.
6. Factory in `modules/<name>/testing/`.
7. Specs for service and controller.
8. Register the module in `app.module.ts`.
9. `npm run lint && npm run typecheck && npm test`.

## Gotchas

- `main.ts` and `test/*.e2e-spec.ts` configure the app **separately**. Change
  global pipes/filters/prefix in one and you must mirror it in the other.
- Health routes are excluded from the global prefix and marked
  `VERSION_NEUTRAL`; adding a new probe route means adding it to the `exclude`
  list in `main.ts` too.
- Nest 11 runs Express 5, whose router rejects the old `(.*)` wildcard syntax.
  Use literal paths or the `*name` form.
- `@nestjs/swagger`'s CLI plugin is enabled in `nest-cli.json`: it infers types
  from TS at build time, so `nest start` and `ts-jest` can disagree about the
  generated schema. Explicit `@ApiProperty` types avoid the ambiguity.
- The coverage config excludes `*.module.ts`, `*.dto.ts`, `*.entity.ts` and
  `testing/` — declaration-only files would otherwise inflate the numbers.
