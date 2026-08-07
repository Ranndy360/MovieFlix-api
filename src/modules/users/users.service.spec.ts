import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/sequelize';
import { Test, type TestingModule } from '@nestjs/testing';

import { seedFaker } from '../../testing/factory';
import { createMockModel, type MockModel } from '../../testing/mock-model';
import { Role, RoleName } from '../roles/entities/role.entity';
import { QueryUsersDto } from './dto/query-users.dto';
import { User } from './entities/user.entity';
import { asUser, buildRole, buildUserStub } from './testing/user.factory';
import { PasswordService } from '../auth/services/password.service';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  let userModel: MockModel;
  let roleModel: MockModel;
  let passwordService: jest.Mocked<Pick<PasswordService, 'hash'>>;

  beforeEach(async () => {
    seedFaker();
    userModel = createMockModel();
    roleModel = createMockModel();
    passwordService = { hash: jest.fn().mockResolvedValue('$2b$12$hashed') };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getModelToken(User), useValue: userModel },
        { provide: getModelToken(Role), useValue: roleModel },
        { provide: PasswordService, useValue: passwordService },
      ],
    }).compile();

    service = moduleRef.get(UsersService);
  });

  describe('email normalization', () => {
    it('lower-cases and trims on lookup', async () => {
      userModel.findOne.mockResolvedValue(null);

      await service.findByEmailWithSecrets('  Ada@Test.IO  ');

      expect(userModel.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: { email: 'ada@test.io' } }),
      );
    });

    it('lower-cases on create, so casing cannot create duplicates', async () => {
      roleModel.findOne.mockResolvedValue(buildRole({ name: RoleName.User }));
      userModel.create.mockResolvedValue(asUser(buildUserStub()));

      await service.create({
        email: 'Ada@TEST.io',
        passwordHash: 'hash',
        firstName: ' Ada ',
        lastName: ' Lovelace ',
        roleName: RoleName.User,
      });

      expect(userModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'ada@test.io',
          firstName: 'Ada',
          lastName: 'Lovelace',
        }),
      );
    });
  });

  describe('findActiveById', () => {
    it('filters out inactive accounts and eager-loads the role', async () => {
      userModel.findOne.mockResolvedValue(null);

      await service.findActiveById('user-1');

      expect(userModel.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1', isActive: true },
          include: [{ model: Role, required: true }],
        }),
      );
    });
  });

  describe('create', () => {
    it('resolves the role by name', async () => {
      const role = buildRole({ name: RoleName.Provider });
      roleModel.findOne.mockResolvedValue(role);
      userModel.create.mockResolvedValue(asUser(buildUserStub()));

      await service.create({
        email: 'p@test.io',
        passwordHash: 'hash',
        firstName: 'P',
        lastName: 'R',
        roleName: RoleName.Provider,
      });

      expect(roleModel.findOne).toHaveBeenCalledWith({ where: { name: RoleName.Provider } });
      expect(userModel.create).toHaveBeenCalledWith(expect.objectContaining({ roleId: role.id }));
    });

    it('fails loudly when the roles table was never seeded', async () => {
      roleModel.findOne.mockResolvedValue(null);

      await expect(
        service.create({
          email: 'p@test.io',
          passwordHash: 'hash',
          firstName: 'P',
          lastName: 'R',
          roleName: RoleName.User,
        }),
      ).rejects.toThrow(/seeders/i);
    });
  });

  describe('createAsAdmin', () => {
    it('hashes the password and assigns the requested role', async () => {
      roleModel.findOne.mockResolvedValue(buildRole({ name: RoleName.Provider }));
      userModel.count.mockResolvedValue(0);
      userModel.create.mockResolvedValue(asUser(buildUserStub({}, RoleName.Provider)));

      await service.createAsAdmin(
        {
          email: 'Grace@Test.IO',
          password: 'Str0ng!Passw0rd',
          firstName: 'Grace',
          lastName: 'Hopper',
          role: RoleName.Provider,
        },
        'admin-1',
      );

      expect(passwordService.hash).toHaveBeenCalledWith('Str0ng!Passw0rd');
      const created = userModel.create.mock.calls[0][0] as Record<string, unknown>;
      expect(created.passwordHash).toBe('$2b$12$hashed');
      expect(created.email).toBe('grace@test.io');
      expect(JSON.stringify(created)).not.toContain('Str0ng!Passw0rd');
    });

    it('can mint an ADMIN — this is the only route that can', async () => {
      roleModel.findOne.mockResolvedValue(buildRole({ name: RoleName.Admin }));
      userModel.count.mockResolvedValue(0);
      userModel.create.mockResolvedValue(asUser(buildUserStub({}, RoleName.Admin)));

      const result = await service.createAsAdmin(
        {
          email: 'boss@test.io',
          password: 'Str0ng!Passw0rd',
          firstName: 'Boss',
          lastName: 'Person',
          role: RoleName.Admin,
        },
        'admin-1',
      );

      expect(result.role).toBe(RoleName.Admin);
    });

    it('rejects a duplicate email with a 409', async () => {
      userModel.count.mockResolvedValue(1);

      await expect(
        service.createAsAdmin(
          {
            email: 'taken@test.io',
            password: 'Str0ng!Passw0rd',
            firstName: 'A',
            lastName: 'B',
            role: RoleName.User,
          },
          'admin-1',
        ),
      ).rejects.toThrow(ConflictException);
      expect(userModel.create).not.toHaveBeenCalled();
    });
  });

  describe('registerFailedLogin', () => {
    it('increments the counter below the threshold', async () => {
      const user = buildUserStub({ failedLoginAttempts: 2 });

      await service.registerFailedLogin(asUser(user), 5, 15);

      expect(user.update).toHaveBeenCalledWith({ failedLoginAttempts: 3 });
    });

    it('locks the account at the threshold and resets the counter', async () => {
      const user = buildUserStub({ failedLoginAttempts: 4 });

      await service.registerFailedLogin(asUser(user), 5, 15);

      const patch = user.update.mock.calls[0][0] as {
        failedLoginAttempts: number;
        lockedUntil: Date;
      };
      expect(patch.failedLoginAttempts).toBe(0);
      expect(patch.lockedUntil.getTime()).toBeGreaterThan(Date.now());
    });

    it('honours the configured lockout window', async () => {
      const user = buildUserStub({ failedLoginAttempts: 0 });

      await service.registerFailedLogin(asUser(user), 1, 30);

      const patch = user.update.mock.calls[0][0] as { lockedUntil: Date };
      const minutes = (patch.lockedUntil.getTime() - Date.now()) / 60_000;
      expect(minutes).toBeGreaterThan(29);
      expect(minutes).toBeLessThanOrEqual(30);
    });
  });

  describe('registerSuccessfulLogin', () => {
    it('clears the lockout state and stamps the login', async () => {
      const user = buildUserStub({ failedLoginAttempts: 3, lockedUntil: new Date() });

      await service.registerSuccessfulLogin(asUser(user));

      const patch = user.update.mock.calls[0][0] as Record<string, unknown>;
      expect(patch).toMatchObject({ failedLoginAttempts: 0, lockedUntil: null });
      expect(patch['lastLoginAt']).toBeInstanceOf(Date);
    });
  });

  describe('updateRole', () => {
    it('assigns the new role', async () => {
      const user = buildUserStub();
      const newRole = buildRole({ name: RoleName.Provider });
      userModel.findByPk.mockResolvedValue(asUser(user));
      roleModel.findOne.mockResolvedValue(newRole);

      const result = await service.updateRole(user.id, RoleName.Provider, 'admin-1');

      expect(user.update).toHaveBeenCalledWith({ roleId: newRole.id });
      expect(result.role).toBe(RoleName.Provider);
    });

    it('stops an admin from demoting themselves', async () => {
      await expect(service.updateRole('admin-1', RoleName.User, 'admin-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(userModel.findByPk).not.toHaveBeenCalled();
    });

    it('lets an admin reassign themselves to ADMIN (a no-op)', async () => {
      const user = buildUserStub();
      userModel.findByPk.mockResolvedValue(asUser(user));
      roleModel.findOne.mockResolvedValue(buildRole({ name: RoleName.Admin }));

      await expect(service.updateRole('admin-1', RoleName.Admin, 'admin-1')).resolves.toBeDefined();
    });

    it('404s for an unknown user', async () => {
      userModel.findByPk.mockResolvedValue(null);

      await expect(service.updateRole('ghost', RoleName.User, 'admin-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('setActive', () => {
    it('deactivates another user', async () => {
      const user = buildUserStub();
      userModel.findByPk.mockResolvedValue(asUser(user));

      await service.setActive(user.id, false, 'admin-1');

      expect(user.update).toHaveBeenCalledWith({ isActive: false });
    });

    it('stops an admin from deactivating themselves', async () => {
      await expect(service.setActive('admin-1', false, 'admin-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('allows self-reactivation', async () => {
      const user = buildUserStub();
      userModel.findByPk.mockResolvedValue(asUser(user));

      await expect(service.setActive('admin-1', true, 'admin-1')).resolves.toBeDefined();
    });
  });

  describe('findAll', () => {
    it('paginates and eager-loads roles', async () => {
      userModel.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

      await service.findAll(Object.assign(new QueryUsersDto(), { page: 2, pageSize: 10 }));

      expect(userModel.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 10, offset: 10, distinct: true }),
      );
    });

    it('resolves a role filter to its id', async () => {
      const role = buildRole({ name: RoleName.Admin });
      roleModel.findOne.mockResolvedValue(role);
      userModel.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

      await service.findAll(Object.assign(new QueryUsersDto(), { role: RoleName.Admin }));

      expect(userModel.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ roleId: role.id }) }),
      );
    });

    it('never returns the password hash', async () => {
      const user = buildUserStub();
      userModel.findAndCountAll.mockResolvedValue({ rows: [asUser(user)], count: 1 });

      const result = await service.findAll(new QueryUsersDto());

      expect(JSON.stringify(result)).not.toContain(user.passwordHash);
      expect(result.items[0]).not.toHaveProperty('passwordHash');
    });
  });
});
