import {
  Column,
  CreatedAt,
  DataType,
  Default,
  HasMany,
  Model,
  PrimaryKey,
  Table,
  Unique,
  UpdatedAt,
} from 'sequelize-typescript';

import { User } from '../../users/entities/user.entity';

/**
 * The complete set of roles. This is a closed enum on purpose: authorization
 * decisions are compile-time checkable, and adding a role is a deliberate
 * change (enum + migration + seeder), never a runtime surprise.
 */
export enum RoleName {
  Admin = 'ADMIN',
  Provider = 'PROVIDER',
  User = 'USER',
}

/** The only role self-service signup may assign. */
export const SIGNUP_ROLE = RoleName.User;

export const ALL_ROLE_NAMES = Object.values(RoleName);

export interface RoleAttributes {
  id: string;
  name: RoleName;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type RoleCreationAttributes = Omit<RoleAttributes, 'id' | 'createdAt' | 'updatedAt'> &
  Partial<Pick<RoleAttributes, 'id'>>;

@Table({ tableName: 'roles', timestamps: true, underscored: true })
export class Role extends Model<RoleAttributes, RoleCreationAttributes> {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column({ type: DataType.UUID, allowNull: false })
  override id!: string;

  @Unique('roles_name_key')
  @Column({ type: DataType.ENUM(...ALL_ROLE_NAMES), allowNull: false })
  name!: RoleName;

  @Column({ type: DataType.STRING(255), allowNull: true })
  description!: string | null;

  @HasMany(() => User)
  users?: User[];

  @CreatedAt
  @Column({ type: DataType.DATE, field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ type: DataType.DATE, field: 'updated_at' })
  declare updatedAt: Date;
}
