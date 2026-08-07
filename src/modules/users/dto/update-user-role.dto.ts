import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsEnum } from 'class-validator';

import { ToBoolean } from '../../../common/transforms/to-boolean.transform';
import { RoleName } from '../../roles/entities/role.entity';

export class UpdateUserRoleDto {
  @ApiProperty({ enum: RoleName, description: 'The role to assign. Admin-only operation.' })
  @IsEnum(RoleName)
  role!: RoleName;
}

export class UpdateUserStatusDto {
  @ApiProperty({ example: false, description: 'Set false to disable the account immediately.' })
  @ToBoolean()
  @IsBoolean()
  isActive!: boolean;
}
