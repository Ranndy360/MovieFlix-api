import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { RoleName } from '../../roles/entities/role.entity';
import type { User } from '../entities/user.entity';

/**
 * The only user shape that ever leaves the API. `passwordHash` has no field
 * here, so it cannot leak by accident when a column is added to the entity.
 */
export class UserResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'ada@movieflix.test' })
  email!: string;

  @ApiProperty({ example: 'Ada' })
  firstName!: string;

  @ApiProperty({ example: 'Lovelace' })
  lastName!: string;

  @ApiProperty({ example: 'Ada Lovelace' })
  fullName!: string;

  @ApiProperty({ enum: RoleName })
  role!: RoleName;

  @ApiProperty({ example: true })
  isActive!: boolean;

  @ApiPropertyOptional({ format: 'date-time', nullable: true, type: String })
  lastLoginAt!: Date | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  static fromEntity(user: User): UserResponseDto {
    if (!user.role) {
      throw new Error('User.role must be eager-loaded before mapping to a response');
    }

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      fullName: user.fullName,
      role: user.role.name,
      isActive: user.isActive,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
    };
  }

  static fromEntities(users: User[]): UserResponseDto[] {
    return users.map((user) => UserResponseDto.fromEntity(user));
  }
}
