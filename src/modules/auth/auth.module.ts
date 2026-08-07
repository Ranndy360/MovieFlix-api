import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { SequelizeModule } from '@nestjs/sequelize';

import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RefreshToken } from './entities/refresh-token.entity';
import { PasswordModule } from './password.module';
import { AuthCookieService } from './services/auth-cookie.service';
import { TokenService } from './services/token.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    ConfigModule,
    UsersModule,
    PasswordModule,
    SequelizeModule.forFeature([RefreshToken]),
    PassportModule.register({ defaultStrategy: 'jwt', session: false }),
    // Secrets are passed per sign/verify call in TokenService, because access
    // and refresh tokens use different ones.
    JwtModule.register({}),
  ],
  controllers: [AuthController],
  providers: [AuthService, TokenService, AuthCookieService, JwtStrategy],
  // PasswordModule is re-exported so anything importing AuthModule still
  // gets PasswordService — the provider itself now lives there.
  exports: [AuthService, TokenService, PasswordModule],
})
export class AuthModule {}
