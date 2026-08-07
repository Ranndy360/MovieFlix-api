/**
 * Typed stand-in for a Sequelize model class in unit tests.
 *
 * Unit tests must not reach Postgres: they assert the *query* the service
 * builds, not what the database does with it. Integration coverage of real SQL
 * belongs in `test/*.e2e-spec.ts`.
 */
export interface MockModel {
  create: jest.Mock;
  findAll: jest.Mock;
  findAndCountAll: jest.Mock;
  findByPk: jest.Mock;
  findOne: jest.Mock;
  update: jest.Mock;
  destroy: jest.Mock;
  count: jest.Mock;
  /**
   * Services that build aggregates reach for `Model.sequelize.fn/col`. The
   * stubs echo their arguments so a spec can assert on the shape of the
   * aggregate without a real dialect.
   */
  sequelize: { fn: jest.Mock; col: jest.Mock };
}

export const createMockModel = (): MockModel => ({
  create: jest.fn(),
  findAll: jest.fn(),
  findAndCountAll: jest.fn(),
  findByPk: jest.fn(),
  findOne: jest.fn(),
  update: jest.fn(),
  destroy: jest.fn(),
  count: jest.fn(),
  sequelize: {
    fn: jest.fn((name: string, col: unknown) => `${name}(${String(col)})`),
    col: jest.fn((name: string) => name),
  },
});
