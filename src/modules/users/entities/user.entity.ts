import {
  BelongsTo,
  Column,
  CreatedAt,
  DataType,
  Default,
  DeletedAt,
  ForeignKey,
  Index,
  Model,
  PrimaryKey,
  Table,
  Unique,
  UpdatedAt,
} from 'sequelize-typescript';

import { Role } from '../../roles/entities/role.entity';

export interface UserAttributes {
  id: string;
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  roleId: string;
  isActive: boolean;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  /** Any token minted before this instant is rejected. */
  passwordChangedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export type UserCreationAttributes = Omit<
  UserAttributes,
  | 'id'
  | 'isActive'
  | 'failedLoginAttempts'
  | 'lockedUntil'
  | 'lastLoginAt'
  | 'passwordChangedAt'
  | 'createdAt'
  | 'updatedAt'
  | 'deletedAt'
> &
  Partial<UserAttributes>;

@Table({ tableName: 'users', timestamps: true, paranoid: true, underscored: true })
export class User extends Model<UserAttributes, UserCreationAttributes> {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column({ type: DataType.UUID, allowNull: false })
  override id!: string;

  /** Always stored lower-cased and trimmed — normalization happens in the DTO. */
  @Unique('users_email_key')
  @Column({ type: DataType.STRING(320), allowNull: false })
  email!: string;

  @Column({ type: DataType.STRING(255), allowNull: false, field: 'password_hash' })
  passwordHash!: string;

  @Column({ type: DataType.STRING(100), allowNull: false, field: 'first_name' })
  firstName!: string;

  @Column({ type: DataType.STRING(100), allowNull: false, field: 'last_name' })
  lastName!: string;

  @Index('users_role_id_idx')
  @ForeignKey(() => Role)
  @Column({ type: DataType.UUID, allowNull: false, field: 'role_id' })
  roleId!: string;

  @BelongsTo(() => Role)
  role?: Role;

  @Default(true)
  @Column({ type: DataType.BOOLEAN, allowNull: false, field: 'is_active' })
  isActive!: boolean;

  @Default(0)
  @Column({ type: DataType.SMALLINT, allowNull: false, field: 'failed_login_attempts' })
  failedLoginAttempts!: number;

  @Column({ type: DataType.DATE, allowNull: true, field: 'locked_until' })
  lockedUntil!: Date | null;

  @Column({ type: DataType.DATE, allowNull: true, field: 'last_login_at' })
  lastLoginAt!: Date | null;

  @Default(DataType.NOW)
  @Column({ type: DataType.DATE, allowNull: false, field: 'password_changed_at' })
  passwordChangedAt!: Date;

  @CreatedAt
  @Column({ type: DataType.DATE, field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ type: DataType.DATE, field: 'updated_at' })
  declare updatedAt: Date;

  @DeletedAt
  @Column({ type: DataType.DATE, field: 'deleted_at' })
  declare deletedAt: Date | null;

  get fullName(): string {
    return `${this.firstName} ${this.lastName}`.trim();
  }

  /** True while a lockout window is still open. */
  isLocked(now: Date = new Date()): boolean {
    return this.lockedUntil !== null && this.lockedUntil.getTime() > now.getTime();
  }

  /**
   * Defense in depth: even if an entity escapes the DTO mapping and gets
   * serialized, the hash must not travel with it.
   */
  override toJSON(): Record<string, unknown> {
    const values = { ...super.toJSON() } as Record<string, unknown>;
    delete values['passwordHash'];
    delete values['password_hash'];
    return values;
  }
}
