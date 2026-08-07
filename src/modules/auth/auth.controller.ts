import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
  ApiTags,
} from '@nestjs/swagger';

import { UserResponseDto } from '../users/dto/user-response.dto';
import { AuthService, type AuthResult } from './auth.service';
import { AUTH_THROTTLE, REFRESH_TOKEN_COOKIE, type RequestContext } from './auth.constants';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { AuthResponseDto, MessageResponseDto } from './dto/auth-response.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { AuthCookieService } from './services/auth-cookie.service';

@ApiTags('auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly cookieService: AuthCookieService,
  ) {}

  @Public()
  @Post('register')
  @Throttle({ default: AUTH_THROTTLE.register })
  @ApiOperation({
    summary: 'Create an account',
    description:
      'Self-service signup. The account is always created with the USER role — ' +
      'ADMIN and PROVIDER can only be granted by an existing admin.',
  })
  @ApiCreatedResponse({ type: AuthResponseDto })
  @ApiConflictResponse({ description: 'Email already registered' })
  @ApiTooManyRequestsResponse({ description: 'Rate limited' })
  async register(
    @Body() dto: RegisterDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponseDto> {
    const result = await this.authService.register(dto, this.contextOf(request));
    return this.respondWithSession(result, response);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: AUTH_THROTTLE.login })
  @ApiOperation({ summary: 'Sign in and start a session' })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiUnauthorizedResponse({ description: 'Invalid email or password' })
  @ApiTooManyRequestsResponse({ description: 'Rate limited or account temporarily locked' })
  async login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponseDto> {
    const result = await this.authService.login(dto, this.contextOf(request));
    return this.respondWithSession(result, response);
  }

  /**
   * Public in the sense that it needs no access token — it authenticates with
   * the refresh cookie, which is exactly what a client uses when its access
   * token has already expired.
   */
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: AUTH_THROTTLE.refresh })
  @ApiOperation({ summary: 'Rotate the session using the refresh cookie' })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiUnauthorizedResponse({ description: 'Missing, expired or already-used refresh token' })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponseDto> {
    const rawToken = this.refreshTokenFrom(request);

    try {
      const result = await this.authService.refresh(rawToken, this.contextOf(request));
      return this.respondWithSession(result, response);
    } catch (error) {
      // A dead session must not leave stale cookies behind, or the client will
      // keep retrying with a token that can never work.
      this.cookieService.clearAuthCookies(response);
      throw error;
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'End the current session' })
  @ApiOkResponse({ type: MessageResponseDto })
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<MessageResponseDto> {
    await this.authService.logout(this.refreshTokenFrom(request));
    this.cookieService.clearAuthCookies(response);

    return { message: 'Signed out' };
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'End every session for the current user' })
  @ApiOkResponse({ type: MessageResponseDto })
  async logoutAll(
    @CurrentUser('id') userId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<MessageResponseDto> {
    const revoked = await this.authService.logoutAll(userId);
    this.cookieService.clearAuthCookies(response);

    return { message: `Signed out of ${revoked} session(s)` };
  }

  @Get('me')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'The currently authenticated profile' })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid session' })
  me(@CurrentUser('id') userId: string): Promise<UserResponseDto> {
    return this.authService.getProfile(userId);
  }

  /* ---------------- helpers ---------------- */

  private respondWithSession(result: AuthResult, response: Response): AuthResponseDto {
    this.cookieService.setAuthCookies(response, result.access, result.refresh);

    return {
      user: result.user,
      expiresIn: Math.max(0, Math.floor((result.access.expiresAt.getTime() - Date.now()) / 1000)),
    };
  }

  private refreshTokenFrom(request: Request): string | undefined {
    const cookies = request.cookies as Record<string, string | undefined> | undefined;
    return cookies?.[REFRESH_TOKEN_COOKIE];
  }

  private contextOf(request: Request): RequestContext {
    return {
      userAgent: request.get('user-agent') ?? null,
      ipAddress: request.ip ?? null,
    };
  }
}
