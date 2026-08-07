import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, type WhereOptions } from 'sequelize';

import { PaginatedResponseDto } from '../../common/dto/paginated-response.dto';
import { PasswordService } from '../auth/services/password.service';
import { Role, RoleName } from '../roles/entities/role.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { QueryUsersDto, UserSortBy } from './dto/query-users.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { User, type UserAttributes } from './entities/user.entity';

const SORT_COLUMN: Record<UserSortBy, keyof UserAttributes> = {
  [UserSortBy.Email]: 'email',
  [UserSortBy.CreatedAt]: 'createdAt',
  [UserSortBy.LastLoginAt]: 'lastLoginAt',
};

export interface CreateUserInput {
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  roleName: RoleName;
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectModel(User) private readonly userModel: typeof User,
    @InjectModel(Role) private readonly roleModel: typeof Role,
    private readonly passwordService: PasswordService,
  ) {}

  /** Includes the password hash — for the login path only. */
  findByEmailWithSecrets(email: string): Promise<User | null> {
    return this.userModel.findOne({
      where: { email: this.normalizeEmail(email) },
      include: [{ model: Role, required: true }],
    });
  }

  /** Used on every authenticated request, so it must stay a single indexed read. */
  findActiveById(id: string): Promise<User | null> {
    return this.userModel.findOne({
      where: { id, isActive: true },
      include: [{ model: Role, required: true }],
    });
  }

  async emailExists(email: string): Promise<boolean> {
    const count = await this.userModel.count({ where: { email: this.normalizeEmail(email) } });
    return count > 0;
  }

  async create(input: CreateUserInput): Promise<User> {
    const role = await this.requireRole(input.roleName);

    const user = await this.userModel.create({
      email: this.normalizeEmail(input.email),
      passwordHash: input.passwordHash,
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      roleId: role.id,
      passwordChangedAt: new Date(),
    });

    // Re-read so `role` is populated for the response mapping.
    user.role = role;

    this.logger.log(`Created user ${user.id} with role ${input.roleName}`);

    return user;
  }

  /**
   * Admin-created account. Hashes here so the controller never handles a
   * plaintext password, and rejects a duplicate up front — the unique index is
   * still the authority, and `AllExceptionsFilter` turns its error into a 409.
   */
  async createAsAdmin(dto: CreateUserDto, actingUserId: string): Promise<UserResponseDto> {
    if (await this.emailExists(dto.email)) {
      throw new ConflictException('An account with this email already exists');
    }

    const user = await this.create({
      email: dto.email,
      passwordHash: await this.passwordService.hash(dto.password),
      firstName: dto.firstName,
      lastName: dto.lastName,
      roleName: dto.role,
    });

    this.logger.log(`User ${user.id} (${dto.role}) created by ${actingUserId}`);

    return UserResponseDto.fromEntity(user);
  }

  /* ---------------- login bookkeeping ---------------- */

  async registerFailedLogin(
    user: User,
    maxAttempts: number,
    lockoutMinutes: number,
  ): Promise<void> {
    const attempts = user.failedLoginAttempts + 1;

    if (attempts >= maxAttempts) {
      const lockedUntil = new Date(Date.now() + lockoutMinutes * 60_000);
      await user.update({ failedLoginAttempts: 0, lockedUntil });
      this.logger.warn(`Locked ${user.email} until ${lockedUntil.toISOString()}`);
      return;
    }

    await user.update({ failedLoginAttempts: attempts });
  }

  async registerSuccessfulLogin(user: User): Promise<void> {
    await user.update({
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
    });
  }

  /* ---------------- admin operations ---------------- */

  async findAll(query: QueryUsersDto): Promise<PaginatedResponseDto<UserResponseDto>> {
    const { rows, count } = await this.userModel.findAndCountAll({
      where: await this.buildWhere(query),
      include: [{ model: Role, required: true }],
      order: [[SORT_COLUMN[query.sortBy], query.sortDirection]],
      limit: query.limit,
      offset: query.offset,
      distinct: true,
    });

    return PaginatedResponseDto.from(
      UserResponseDto.fromEntities(rows),
      count,
      query.page,
      query.pageSize,
    );
  }

  async findOne(id: string): Promise<UserResponseDto> {
    return UserResponseDto.fromEntity(await this.findEntityOrFail(id));
  }

  async updateRole(id: string, roleName: RoleName, actingUserId: string): Promise<UserResponseDto> {
    // Without this an admin can demote themselves and lock the whole team out
    // of user administration.
    if (id === actingUserId && roleName !== RoleName.Admin) {
      throw new BadRequestException('You cannot remove your own admin role');
    }

    const user = await this.findEntityOrFail(id);
    const role = await this.requireRole(roleName);

    await user.update({ roleId: role.id });
    user.role = role;

    this.logger.log(`User ${id} role changed to ${roleName} by ${actingUserId}`);

    return UserResponseDto.fromEntity(user);
  }

  async setActive(id: string, isActive: boolean, actingUserId: string): Promise<UserResponseDto> {
    if (id === actingUserId && !isActive) {
      throw new BadRequestException('You cannot deactivate your own account');
    }

    const user = await this.findEntityOrFail(id);
    await user.update({ isActive });

    this.logger.log(`User ${id} ${isActive ? 'activated' : 'deactivated'} by ${actingUserId}`);

    return UserResponseDto.fromEntity(user);
  }

  /* ---------------- helpers ---------------- */

  private async findEntityOrFail(id: string): Promise<User> {
    const user = await this.userModel.findByPk(id, { include: [{ model: Role, required: true }] });

    if (!user) {
      throw new NotFoundException(`User with id "${id}" was not found`);
    }

    return user;
  }

  private async requireRole(name: RoleName): Promise<Role> {
    const role = await this.roleModel.findOne({ where: { name } });

    if (!role) {
      throw new Error(`Role "${name}" is missing. Run the database seeders.`);
    }

    return role;
  }

  private async buildWhere(query: QueryUsersDto): Promise<WhereOptions<UserAttributes>> {
    const where: WhereOptions<UserAttributes> = {};

    if (query.search) {
      Object.assign(where, {
        [Op.or]: [
          { email: { [Op.iLike]: `%${query.search}%` } },
          { firstName: { [Op.iLike]: `%${query.search}%` } },
          { lastName: { [Op.iLike]: `%${query.search}%` } },
        ],
      });
    }

    if (query.isActive !== undefined) {
      Object.assign(where, { isActive: query.isActive });
    }

    if (query.role) {
      const role = await this.requireRole(query.role);
      Object.assign(where, { roleId: role.id });
    }

    return where;
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }
}
