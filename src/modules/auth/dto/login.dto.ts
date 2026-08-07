import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, Length, MaxLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'ada@movieflix.test' })
  @IsEmail({}, { message: 'A valid email address is required' })
  @MaxLength(320)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email!: string;

  /**
   * Only bounded, never policy-checked. Applying the signup rules here would
   * tell an attacker which guesses are even worth submitting, and would lock
   * out users whose password predates a policy change.
   */
  @ApiProperty({ example: 'Corr3ct-Horse!Battery' })
  @IsString()
  @Length(1, 72)
  password!: string;
}
