import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
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
  constructor(
    private readonly health: HealthCheckService,
    private readonly database: SequelizeHealthIndicator,
    private readonly memory: MemoryHealthIndicator,
  ) {}

  /** Liveness: is the process up? Must never touch downstream dependencies. */
  @Get('liveness')
  @ApiOperation({ summary: 'Liveness probe' })
  @HealthCheck()
  liveness(): Promise<HealthCheckResult> {
    return this.health.check([() => this.memory.checkHeap('memory_heap', MEMORY_HEAP_LIMIT_BYTES)]);
  }

  /** Readiness: can the process serve traffic? Checks the database. */
  @Get('readiness')
  @ApiOperation({ summary: 'Readiness probe' })
  @HealthCheck()
  readiness(): Promise<HealthCheckResult> {
    return this.health.check([() => this.database.pingCheck('database', { timeout: 1500 })]);
  }
}
