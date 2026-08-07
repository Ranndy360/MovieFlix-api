import { faker } from '@faker-js/faker';

import { defineFactory } from '../../../testing/factory';
import {
  WatchlistStatus,
  type WatchlistEntry,
  type WatchlistEntryAttributes,
} from '../entities/watchlist-entry.entity';

export const watchlistEntryAttributesFactory = defineFactory<WatchlistEntryAttributes>(() => {
  const createdAt = faker.date.past({ years: 1 });

  return {
    id: faker.string.uuid(),
    userId: faker.string.uuid(),
    movieId: faker.string.uuid(),
    status: WatchlistStatus.Want,
    watchedAt: null,
    createdAt,
    updatedAt: faker.date.between({ from: createdAt, to: new Date() }),
  };
});

export interface WatchlistEntryStub extends WatchlistEntryAttributes {
  isWatched: boolean;
  movie?: unknown;
  update: jest.Mock;
  destroy: jest.Mock;
}

export const buildWatchlistEntryStub = (
  overrides: Partial<WatchlistEntryAttributes> = {},
): WatchlistEntryStub => {
  const attributes = watchlistEntryAttributesFactory.build(overrides);

  const stub: WatchlistEntryStub = {
    ...attributes,
    get isWatched(): boolean {
      return stub.status === WatchlistStatus.Watched;
    },
    update: jest.fn(),
    destroy: jest.fn().mockResolvedValue(undefined),
  };

  stub.update.mockImplementation((patch: Partial<WatchlistEntryAttributes>) => {
    Object.assign(stub, patch);
    return Promise.resolve(stub);
  });

  return stub;
};

/** Already watched — the precondition for leaving a review. */
export const buildWatchedEntryStub = (
  overrides: Partial<WatchlistEntryAttributes> = {},
): WatchlistEntryStub =>
  buildWatchlistEntryStub({
    status: WatchlistStatus.Watched,
    watchedAt: faker.date.recent(),
    ...overrides,
  });

export const asWatchlistEntry = (stub: WatchlistEntryStub): WatchlistEntry =>
  stub as unknown as WatchlistEntry;
