import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, IsStrongPassword, Length, Matches, MaxLength } from 'class-validator';

export const PASSWORD_POLICY = {
  minLength: 12,
  minLowercase: 1,
  minUppercase: 1,
  minNumbers: 1,
  minSymbols: 1,
} as const;

export const PASSWORD_RULE_MESSAGE =
  'Password must be at least 12 characters and include an uppercase letter, a lowercase letter, a number and a symbol';

/**
 * Self-service signup.
 *
 * There is deliberately **no `role` field**. The API assigns `USER`
 * unconditionally, and because the global `ValidationPipe` runs with
 * `forbidNonWhitelisted: true`, a client that tries to smuggle
 * `{"role": "ADMIN"}` gets a 400 instead of a silently-ignored property.
 * Elevated roles are granted only by an existing admin or by the seeder.
 */
export class RegisterDto {
  @ApiProperty({ example: 'ada@movieflix.test', maxLength: 320 })
  @IsEmail({}, { message: 'A valid email address is required' })
  @MaxLength(320)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email!: string;

  @ApiProperty({ example: 'Corr3ct-Horse!Battery', minLength: 12, maxLength: 128 })
  @IsString()
  // Upper bound matters: bcrypt silently truncates past 72 bytes, and an
  // unbounded password is a cheap CPU-exhaustion vector. The lower bound comes
  // from IsStrongPassword, so the two never both fire for one input.
  @MaxLength(72, { message: 'Password must not exceed 72 characters' })
  @IsStrongPassword(PASSWORD_POLICY, { message: PASSWORD_RULE_MESSAGE })
  password!: string;

  @ApiProperty({ example: 'Ada', maxLength: 100 })
  @IsString()
  @Length(1, 100)
  @Matches(/^[\p{L}\p{M}'\-. ]+$/u, { message: 'First name contains invalid characters' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  firstName!: string;

  @ApiProperty({ example: 'Lovelace', maxLength: 100 })
  @IsString()
  @Length(1, 100)
  @Matches(/^[\p{L}\p{M}'\-. ]+$/u, { message: 'Last name contains invalid characters' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  lastName!: string;
}
