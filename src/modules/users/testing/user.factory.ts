import { faker } from '@faker-js/faker';

import { defineFactory } from '../../../testing/factory';
import { RoleName, type Role, type RoleAttributes } from '../../roles/entities/role.entity';
import type { User, UserAttributes } from '../entities/user.entity';

export const roleAttributesFactory = defineFactory<RoleAttributes>(() => ({
  id: faker.string.uuid(),
  name: RoleName.User,
  description: faker.lorem.sentence(),
  createdAt: faker.date.past({ years: 1 }),
  updatedAt: new Date(),
}));

export const buildRole = (overrides: Partial<RoleAttributes> = {}): Role =>
  roleAttributesFactory.build(overrides) as unknown as Role;

export const userAttributesFactory = defineFactory<UserAttributes>(() => {
  const createdAt = faker.date.past({ years: 1 });

  return {
    id: faker.string.uuid(),
    email: faker.internet.email().toLowerCase(),
    // A realistic bcrypt digest — tests never depend on it being crackable.
    passwordHash: '$2b$12$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ012',
    firstName: faker.person.firstName(),
    lastName: faker.person.lastName(),
    roleId: faker.string.uuid(),
    isActive: true,
    failedLoginAttempts: 0,
    lockedUntil: null,
    lastLoginAt: null,
    passwordChangedAt: createdAt,
    createdAt,
    updatedAt: new Date(),
    deletedAt: null,
  };
});

/**
 * A `User` test double: row data, the association, the real instance helpers
 * (`isLocked`, `fullName`) and jest-mocked persistence methods.
 */
export interface UserStub extends UserAttributes {
  role: Role;
  fullName: string;
  isLocked: (now?: Date) => boolean;
  update: jest.Mock;
  destroy: jest.Mock;
  toJSON: jest.Mock;
}

export const buildUserStub = (
  overrides: Partial<UserAttributes> = {},
  roleName: RoleName = RoleName.User,
): UserStub => {
  const role = buildRole({ name: roleName });
  const attributes = userAttributesFactory.build({ roleId: role.id, ...overrides });

  const stub: UserStub = {
    ...attributes,
    role,
    get fullName(): string {
      return `${stub.firstName} ${stub.lastName}`.trim();
    },
    isLocked: (now: Date = new Date()) =>
      stub.lockedUntil !== null && stub.lockedUntil.getTime() > now.getTime(),
    update: jest.fn(),
    destroy: jest.fn().mockResolvedValue(undefined),
    toJSON: jest.fn(() => {
      const { passwordHash: _omitted, ...rest } = attributes;
      return rest;
    }),
  };

  stub.update.mockImplementation((patch: Partial<UserAttributes>) => {
    Object.assign(stub, patch);
    return Promise.resolve(stub);
  });

  return stub;
};

export const asUser = (stub: UserStub): User => stub as unknown as User;

export const buildAdminStub = (overrides: Partial<UserAttributes> = {}): UserStub =>
  buildUserStub(overrides, RoleName.Admin);

export const buildProviderStub = (overrides: Partial<UserAttributes> = {}): UserStub =>
  buildUserStub(overrides, RoleName.Provider);

/** A locked account: `lockedUntil` in the future. */
export const buildLockedUserStub = (minutes = 15): UserStub =>
  buildUserStub({ lockedUntil: new Date(Date.now() + minutes * 60_000) });
