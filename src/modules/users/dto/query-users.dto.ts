import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsString, Length } from 'class-validator';

import { ToBoolean } from '../../../common/transforms/to-boolean.transform';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { RoleName } from '../../roles/entities/role.entity';

export enum UserSortBy {
  Email = 'email',
  CreatedAt = 'createdAt',
  LastLoginAt = 'lastLoginAt',
}

export class QueryUsersDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Case-insensitive partial match on email or name' })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  search?: string;

  @ApiPropertyOptional({ enum: RoleName })
  @IsOptional()
  @IsEnum(RoleName)
  role?: RoleName;

  @ApiPropertyOptional()
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ enum: UserSortBy, default: UserSortBy.CreatedAt })
  @IsOptional()
  @IsEnum(UserSortBy)
  sortBy: UserSortBy = UserSortBy.CreatedAt;
}
