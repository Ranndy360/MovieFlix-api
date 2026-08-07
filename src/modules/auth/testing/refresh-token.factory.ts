import { faker } from '@faker-js/faker';

import { defineFactory } from '../../../testing/factory';
import type { RefreshToken, RefreshTokenAttributes } from '../entities/refresh-token.entity';

export const refreshTokenAttributesFactory = defineFactory<RefreshTokenAttributes>(() => ({
  id: faker.string.uuid(),
  userId: faker.string.uuid(),
  jti: faker.string.uuid(),
  tokenHash: faker.string.hexadecimal({ length: 64, casing: 'lower', prefix: '' }),
  expiresAt: faker.date.future({ years: 1 }),
  revokedAt: null,
  replacedByJti: null,
  userAgent: faker.internet.userAgent(),
  ipAddress: faker.internet.ip(),
  createdAt: faker.date.recent(),
  updatedAt: new Date(),
}));

export interface RefreshTokenStub extends RefreshTokenAttributes {
  isRevoked: boolean;
  isExpired: (now?: Date) => boolean;
  isUsable: (now?: Date) => boolean;
  update: jest.Mock;
}

export const buildRefreshTokenStub = (
  overrides: Partial<RefreshTokenAttributes> = {},
): RefreshTokenStub => {
  const attributes = refreshTokenAttributesFactory.build(overrides);

  const stub: RefreshTokenStub = {
    ...attributes,
    get isRevoked(): boolean {
      return stub.revokedAt !== null;
    },
    isExpired: (now: Date = new Date()) => stub.expiresAt.getTime() <= now.getTime(),
    isUsable: (now: Date = new Date()) => !stub.isRevoked && !stub.isExpired(now),
    update: jest.fn(),
  };

  stub.update.mockImplementation((patch: Partial<RefreshTokenAttributes>) => {
    Object.assign(stub, patch);
    return Promise.resolve(stub);
  });

  return stub;
};

export const asRefreshToken = (stub: RefreshTokenStub): RefreshToken =>
  stub as unknown as RefreshToken;

/** Already rotated — presenting this again is the reuse-detection trigger. */
export const buildRevokedRefreshTokenStub = (
  overrides: Partial<RefreshTokenAttributes> = {},
): RefreshTokenStub =>
  buildRefreshTokenStub({ revokedAt: new Date(Date.now() - 60_000), ...overrides });

export const buildExpiredRefreshTokenStub = (
  overrides: Partial<RefreshTokenAttributes> = {},
): RefreshTokenStub =>
  buildRefreshTokenStub({ expiresAt: new Date(Date.now() - 60_000), ...overrides });
