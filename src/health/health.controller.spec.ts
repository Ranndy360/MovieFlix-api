import { Test, type TestingModule } from '@nestjs/testing';
import {
  HealthCheckService,
  MemoryHealthIndicator,
  SequelizeHealthIndicator,
  type HealthCheckResult,
} from '@nestjs/terminus';

import { HealthController } from './health.controller';

const okResult: HealthCheckResult = { status: 'ok', info: {}, error: {}, details: {} };

describe('HealthController', () => {
  let controller: HealthController;
  let health: { check: jest.Mock };
  let database: { pingCheck: jest.Mock };
  let memory: { checkHeap: jest.Mock };

  beforeEach(async () => {
    health = { check: jest.fn().mockResolvedValue(okResult) };
    database = { pingCheck: jest.fn() };
    memory = { checkHeap: jest.fn() };

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthCheckService, useValue: health },
        { provide: SequelizeHealthIndicator, useValue: database },
        { provide: MemoryHealthIndicator, useValue: memory },
      ],
    }).compile();

    controller = moduleRef.get(HealthController);
  });

  it('liveness checks heap only — never a downstream dependency', async () => {
    await expect(controller.liveness()).resolves.toBe(okResult);

    const indicators = health.check.mock.calls[0][0] as Array<() => unknown>;
    indicators.forEach((indicator) => indicator());

    expect(memory.checkHeap).toHaveBeenCalledWith('memory_heap', 300 * 1024 * 1024);
    expect(database.pingCheck).not.toHaveBeenCalled();
  });

  it('readiness pings the database with a timeout', async () => {
    await expect(controller.readiness()).resolves.toBe(okResult);

    const indicators = health.check.mock.calls[0][0] as Array<() => unknown>;
    indicators.forEach((indicator) => indicator());

    expect(database.pingCheck).toHaveBeenCalledWith('database', { timeout: 1500 });
  });
});
