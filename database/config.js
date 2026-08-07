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

module.exports = {
  development: base,
  test: { ...base, database: process.env.DB_NAME || 'movieflix_test', logging: false },
  staging: process.env.DB_SSL === 'true' ? withSsl : base,
  production: process.env.DB_SSL === 'true' ? withSsl : base,
};
