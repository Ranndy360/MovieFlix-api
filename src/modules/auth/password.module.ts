import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { PasswordService } from './services/password.service';

/**
 * Hashing on its own, so both `AuthModule` (registration, login) and
 * `UsersModule` (an admin creating an account) can use it.
 *
 * It has to be a separate module: `AuthModule` already imports `UsersModule`,
 * so having `UsersModule` import `AuthModule` back would be a cycle needing
 * `forwardRef`. This depends on nothing but config, so it stays a leaf.
 */
@Module({
  imports: [ConfigModule],
  providers: [PasswordService],
  exports: [PasswordService],
})
export class PasswordModule {}
