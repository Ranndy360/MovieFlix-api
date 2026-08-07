import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsString,
  IsStrongPassword,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

import { PASSWORD_POLICY, PASSWORD_RULE_MESSAGE } from '../../auth/dto/register.dto';
import { RoleName } from '../../roles/entities/role.entity';

/**
 * Admin-only account creation.
 *
 * Unlike `RegisterDto` this one **does** carry a role — that is the whole
 * point, and it is why the endpoint is behind `@Roles(RoleName.Admin)`. The
 * password rules are imported rather than restated so the two paths can never
 * drift apart.
 */
export class CreateUserDto {
  @ApiProperty({ example: 'grace@movieflix.test', maxLength: 320 })
  @IsEmail({}, { message: 'A valid email address is required' })
  @MaxLength(320)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email!: string;

  @ApiProperty({ example: 'Corr3ct-Horse!Battery', minLength: 12, maxLength: 72 })
  @IsString()
  @MaxLength(72, { message: 'Password must not exceed 72 characters' })
  @IsStrongPassword(PASSWORD_POLICY, { message: PASSWORD_RULE_MESSAGE })
  password!: string;

  @ApiProperty({ example: 'Grace', maxLength: 100 })
  @IsString()
  @Length(1, 100)
  @Matches(/^[\p{L}\p{M}'\-. ]+$/u, { message: 'First name contains invalid characters' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  firstName!: string;

  @ApiProperty({ example: 'Hopper', maxLength: 100 })
  @IsString()
  @Length(1, 100)
  @Matches(/^[\p{L}\p{M}'\-. ]+$/u, { message: 'Last name contains invalid characters' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  lastName!: string;

  @ApiProperty({ enum: RoleName, description: 'Any role, including ADMIN.' })
  @IsEnum(RoleName)
  role!: RoleName;
}
