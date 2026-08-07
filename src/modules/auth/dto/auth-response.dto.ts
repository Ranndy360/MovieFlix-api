import { ApiProperty } from '@nestjs/swagger';

import { UserResponseDto } from '../../users/dto/user-response.dto';

/**
 * Note what is **absent**: no access token, no refresh token.
 *
 * Both are delivered as `httpOnly` cookies, so no JavaScript — ours or an
 * injected script's — can read them. The body carries only the profile the UI
 * needs to render.
 */
export class AuthResponseDto {
  @ApiProperty({ type: UserResponseDto })
  user!: UserResponseDto;

  @ApiProperty({
    example: 900,
    description: 'Seconds until the access cookie expires; use it to schedule a refresh.',
  })
  expiresIn!: number;
}

export class MessageResponseDto {
  @ApiProperty({ example: 'Signed out' })
  message!: string;
}
