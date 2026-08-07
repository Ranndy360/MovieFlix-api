import { Test, type TestingModule } from '@nestjs/testing';

import { PaginatedResponseDto } from '../../common/dto/paginated-response.dto';
import { RoleName } from '../roles/entities/role.entity';
import { QueryUsersDto } from './dto/query-users.dto';
import type { UserResponseDto } from './dto/user-response.dto';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

const buildResponseDto = (overrides: Partial<UserResponseDto> = {}): UserResponseDto => ({
  id: 'user-1',
  email: 'ada@test.io',
  firstName: 'Ada',
  lastName: 'Lovelace',
  fullName: 'Ada Lovelace',
  role: RoleName.User,
  isActive: true,
  lastLoginAt: null,
  createdAt: new Date(),
  ...overrides,
});

describe('UsersController', () => {
  let controller: UsersController;
  let service: jest.Mocked<
    Pick<UsersService, 'findAll' | 'findOne' | 'updateRole' | 'setActive' | 'createAsAdmin'>
  >;

  beforeEach(async () => {
    service = {
      findAll: jest.fn(),
      findOne: jest.fn(),
      updateRole: jest.fn(),
      setActive: jest.fn(),
      createAsAdmin: jest.fn(),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: service }],
    }).compile();

    controller = moduleRef.get(UsersController);
  });

  it('creates a user and records who did it', async () => {
    const dto = buildResponseDto({ role: RoleName.Provider });
    service.createAsAdmin.mockResolvedValue(dto);
    const payload = {
      email: 'grace@test.io',
      password: 'Str0ng!Passw0rd',
      firstName: 'Grace',
      lastName: 'Hopper',
      role: RoleName.Provider,
    };

    await expect(controller.create(payload, 'admin-9')).resolves.toBe(dto);
    expect(service.createAsAdmin).toHaveBeenCalledWith(payload, 'admin-9');
  });

  it('delegates the paginated list', async () => {
    const page = PaginatedResponseDto.from([buildResponseDto()], 1, 1, 20);
    service.findAll.mockResolvedValue(page);
    const query = new QueryUsersDto();

    await expect(controller.findAll(query)).resolves.toBe(page);
    expect(service.findAll).toHaveBeenCalledWith(query);
  });

  it('delegates findOne', async () => {
    const dto = buildResponseDto();
    service.findOne.mockResolvedValue(dto);

    await expect(controller.findOne('user-1')).resolves.toBe(dto);
  });

  it('passes the ACTING admin id to updateRole', async () => {
    const dto = buildResponseDto({ role: RoleName.Provider });
    service.updateRole.mockResolvedValue(dto);

    await controller.updateRole('user-1', { role: RoleName.Provider }, 'admin-9');

    // Taken from the token via @CurrentUser, never from the request body —
    // otherwise a caller could spoof who performed the change.
    expect(service.updateRole).toHaveBeenCalledWith('user-1', RoleName.Provider, 'admin-9');
  });

  it('passes the acting admin id to the status change', async () => {
    const dto = buildResponseDto({ isActive: false });
    service.setActive.mockResolvedValue(dto);

    await controller.updateStatus('user-1', { isActive: false }, 'admin-9');

    expect(service.setActive).toHaveBeenCalledWith('user-1', false, 'admin-9');
  });

  it('never exposes a password hash through the response type', async () => {
    service.findOne.mockResolvedValue(buildResponseDto());

    const result = await controller.findOne('user-1');

    expect(result).not.toHaveProperty('passwordHash');
  });
});
