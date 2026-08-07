import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';

import type { AuthConfig } from '../../../config/configuration';

@Injectable()
export class PasswordService implements OnModuleInit {
  private readonly logger = new Logger(PasswordService.name);
  private readonly rounds: number;

  /**
   * A throwaway hash used to burn the same CPU time when the email does not
   * exist. Without it, "unknown email" returns measurably faster than "wrong
   * password" and the login endpoint becomes a user-enumeration oracle.
   */
  private dummyHash = '';

  constructor(private readonly configService: ConfigService) {
    this.rounds = this.configService.getOrThrow<AuthConfig>('auth').bcryptRounds;
  }

  async onModuleInit(): Promise<void> {
    this.dummyHash = await bcrypt.hash(randomBytes(24).toString('hex'), this.rounds);
    this.logger.log(`Password hashing ready (bcrypt, ${this.rounds} rounds)`);
  }

  hash(plainText: string): Promise<string> {
    return bcrypt.hash(plainText, this.rounds);
  }

  compare(plainText: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plainText, hash);
  }

  /**
   * Call on the "user not found" path so it costs the same as a real check.
   * Always resolves `false`.
   */
  async compareWithDummy(plainText: string): Promise<boolean> {
    if (!this.dummyHash) {
      this.dummyHash = await bcrypt.hash(randomBytes(24).toString('hex'), this.rounds);
    }
    await bcrypt.compare(plainText, this.dummyHash);
    return false;
  }
}
