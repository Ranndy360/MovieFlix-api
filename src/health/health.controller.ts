import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  HealthCheck,
  HealthCheckResult,
  HealthCheckService,
  MemoryHealthIndicator,
  SequelizeHealthIndicator,
} from '@nestjs/terminus';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../modules/auth/decorators/public.decorator';

const MEMORY_HEAP_LIMIT_BYTES = 300 * 1024 * 1024;

// Probes must answer before anyone can authenticate.
@Public()
@ApiTags('health')
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  private readonly databaseTimeoutMs: number;

  constructor(
    private readonly health: HealthCheckService,
    private readonly database: SequelizeHealthIndicator,
    private readonly memory: MemoryHealthIndicator,
    configService: ConfigService,
  ) {
    this.databaseTimeoutMs = configService.get<number>('app.healthDbTimeoutMs') ?? 5000;
  }

  /** Liveness: is the process up? Must never touch downstream dependencies. */
  @Get('liveness')
  @ApiOperation({ summary: 'Liveness probe' })
  @HealthCheck()
  liveness(): Promise<HealthCheckResult> {
    return this.health.check([() => this.memory.checkHeap('memory_heap', MEMORY_HEAP_LIMIT_BYTES)]);
  }

  /**
   * Readiness: can the process serve traffic? Checks the database.
   *
   * The timeout has to survive the *first* ping of a deploy, which is the
   * slowest one by far: a managed Postgres is reached over the network, so that
   * ping pays for a TCP connection, a TLS handshake and the pool warming up.
   * Against a local container the same call takes ten milliseconds, which is
   * how a 1500ms limit looked generous right up until it failed the first
   * health check on every deploy and got the container killed.
   */
  @Get('readiness')
  @ApiOperation({ summary: 'Readiness probe' })
  @HealthCheck()
  readiness(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.database.pingCheck('database', { timeout: this.databaseTimeoutMs }),
    ]);
  }
}
