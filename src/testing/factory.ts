import { faker } from '@faker-js/faker';

export type FactoryDefinition<T> = (index: number) => T;

/**
 * Minimal, dependency-free object mother.
 *
 * Every factory produces a *complete, valid* object; a test then overrides only
 * the fields it is actually asserting on. That keeps the intent of a test
 * visible and stops unrelated schema changes from breaking dozens of specs.
 */
export class Factory<T extends object> {
  constructor(private readonly definition: FactoryDefinition<T>) {}

  /** One object, with `overrides` applied on top of the generated defaults. */
  build(overrides: Partial<T> = {}, index = 0): T {
    return { ...this.definition(index), ...overrides };
  }

  /** `count` objects; `overrides` may be a value or a per-index function. */
  buildMany(count: number, overrides: Partial<T> | ((index: number) => Partial<T>) = {}): T[] {
    return Array.from({ length: count }, (_unused, index) =>
      this.build(typeof overrides === 'function' ? overrides(index) : overrides, index),
    );
  }

  /** Derives a new factory whose defaults are this one's plus `defaults`. */
  extend(defaults: Partial<T> | ((index: number) => Partial<T>)): Factory<T> {
    return new Factory<T>((index) => ({
      ...this.definition(index),
      ...(typeof defaults === 'function' ? defaults(index) : defaults),
    }));
  }
}

export const defineFactory = <T extends object>(definition: FactoryDefinition<T>): Factory<T> =>
  new Factory<T>(definition);

/**
 * Pins faker's PRNG so a failing test can be replayed exactly. Call from a
 * spec's `beforeEach` when the assertions depend on generated values.
 */
export const seedFaker = (seed = 20260101): void => {
  faker.seed(seed);
};
