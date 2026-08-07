/**
 * Consumed by `sequelize-cli` only (migrations and seeders). The application
 * itself is configured in src/database/database.module.ts — both read the same
 * environment variables so they can never drift.
 */
const base = {
  username: process.env.DB_USERNAME || 'movieflix',
  password: process.env.DB_PASSWORD || 'movieflix',
  database: process.env.DB_NAME || 'movieflix',
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  dialect: 'postgres',
  logging: process.env.DB_LOGGING === 'true' ? console.log : false,
  define: {
    underscored: true,
    timestamps: true,
  },
  migrationStorageTableName: 'sequelize_meta',
  seederStorage: 'sequelize',
  seederStorageTableName: 'sequelize_seeder_meta',
};

const withSsl = {
  ...base,
  dialectOptions: {
    ssl: { require: true, rejectUnauthorized: false },
  },
};

/*
 * A managed Postgres hands you one URL. `sequelize-cli` only understands it
 * through `use_env_variable`, so without this the migrations on a deploy run
 * against the localhost defaults above and fail — after the app itself has
 * connected perfectly well, which makes for a confusing five minutes.
 */
const fromUrl = process.env.DATABASE_URL
  ? {
      use_env_variable: 'DATABASE_URL',
      dialect: 'postgres',
      logging: base.logging,
      define: base.define,
      migrationStorageTableName: base.migrationStorageTableName,
      seederStorage: base.seederStorage,
      seederStorageTableName: base.seederStorageTableName,
      // Managed Postgres is reached over the public internet, so TLS is on by
      // default with a URL. An explicit DB_SSL=false still wins, for a URL that
      // points at a local container — mirrors how the app resolves it.
      ...(process.env.DB_SSL === 'false'
        ? {}
        : { dialectOptions: { ssl: { require: true, rejectUnauthorized: false } } }),
    }
  : null;

const deployed = fromUrl ?? (process.env.DB_SSL === 'true' ? withSsl : base);

module.exports = {
  development: fromUrl ?? base,
  test: { ...base, database: process.env.DB_NAME || 'movieflix_test', logging: false },
  staging: deployed,
  production: deployed,
};
