import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';

import { AuthService } from '../auth.service';

/** Once a day is plenty: nothing depends on the row disappearing promptly. */
const INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Deletes refresh tokens that can no longer be used.
 *
 * `AuthService.pruneExpiredTokens` existed and nothing called it, so the table
 * only ever grew — one row per sign-in, kept for a 30-day window and then kept
 * forever. Sessions rotate on every refresh, so a busy account produces a row
 * every fifteen minutes.
 *
 * A plain interval rather than `@nestjs/schedule`: the requirement is "delete
 * some rows about once a day", which does not justify a dependency, a cron
 * parser and a second scheduler in the process. It is `unref`'d so it never
 * holds the process open, and it is skipped under test so specs do not inherit
 * a stray timer.
 */
@Injectable()
export class RefreshTokenCleanupService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(RefreshTokenCleanupService.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly authService: AuthService) {}

  onApplicationBootstrap(): void {
    if (process.env.NODE_ENV === 'test') return;

    // Not on boot: a deploy restarts every instance at once, and a table scan
    // is not what the first seconds of a new container should be spending on.
    this.timer = setInterval(() => void this.prune(), INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async prune(): Promise<void> {
    try {
      const removed = await this.authService.pruneExpiredTokens();
      // Silence when there was nothing to do — a daily "removed 0 rows" line is
      // noise that trains you to skip the log.
      if (removed > 0) {
        this.logger.log(`Pruned ${removed} expired or revoked refresh token(s)`);
      }
    } catch (error) {
      // Housekeeping must never take the process down.
      this.logger.warn(
        `Refresh-token cleanup failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }
}
