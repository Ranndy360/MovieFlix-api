import { Logger } from '@nestjs/common';

import { type AuthService } from '../auth.service';
import { RefreshTokenCleanupService } from './refresh-token-cleanup.service';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

describe('RefreshTokenCleanupService', () => {
  let authService: { pruneExpiredTokens: jest.Mock };
  let service: RefreshTokenCleanupService;
  let originalNodeEnv: string | undefined;

  beforeEach(() => {
    jest.useFakeTimers();
    originalNodeEnv = process.env.NODE_ENV;
    // The service deliberately does nothing under test; these specs are about
    // the behaviour every other environment gets.
    process.env.NODE_ENV = 'production';

    authService = { pruneExpiredTokens: jest.fn().mockResolvedValue(0) };
    service = new RefreshTokenCleanupService(authService as unknown as AuthService);
  });

  afterEach(() => {
    service.onModuleDestroy();
    process.env.NODE_ENV = originalNodeEnv;
    jest.useRealTimers();
  });

  it('does not scan the table while the container is still starting', () => {
    service.onApplicationBootstrap();

    // A deploy restarts every instance at once; a table scan is a poor use of
    // the first seconds of a new one.
    expect(authService.pruneExpiredTokens).not.toHaveBeenCalled();
  });

  it('prunes once a day', async () => {
    service.onApplicationBootstrap();

    await jest.advanceTimersByTimeAsync(ONE_DAY_MS);
    expect(authService.pruneExpiredTokens).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(ONE_DAY_MS);
    expect(authService.pruneExpiredTokens).toHaveBeenCalledTimes(2);
  });

  it('stays quiet when there was nothing to delete', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    service.onApplicationBootstrap();

    await jest.advanceTimersByTimeAsync(ONE_DAY_MS);

    // A daily "removed 0 rows" trains you to skip the log.
    expect(log).not.toHaveBeenCalled();
  });

  it('reports what it removed', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    authService.pruneExpiredTokens.mockResolvedValue(12);
    service.onApplicationBootstrap();

    await jest.advanceTimersByTimeAsync(ONE_DAY_MS);

    expect(log).toHaveBeenCalledWith(expect.stringContaining('12'));
  });

  it('survives a failing query', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    authService.pruneExpiredTokens.mockRejectedValue(new Error('connection reset'));
    service.onApplicationBootstrap();

    // Housekeeping must never bring the process down with an unhandled rejection.
    await expect(jest.advanceTimersByTimeAsync(ONE_DAY_MS)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('connection reset'));
  });

  it('keeps running after a failure', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    authService.pruneExpiredTokens.mockRejectedValueOnce(new Error('blip')).mockResolvedValue(0);
    service.onApplicationBootstrap();

    await jest.advanceTimersByTimeAsync(ONE_DAY_MS * 2);

    expect(authService.pruneExpiredTokens).toHaveBeenCalledTimes(2);
  });

  it('stops when the module is torn down', async () => {
    service.onApplicationBootstrap();
    service.onModuleDestroy();

    await jest.advanceTimersByTimeAsync(ONE_DAY_MS * 3);

    expect(authService.pruneExpiredTokens).not.toHaveBeenCalled();
  });

  it('does not schedule anything under test', async () => {
    process.env.NODE_ENV = 'test';
    service.onApplicationBootstrap();

    await jest.advanceTimersByTimeAsync(ONE_DAY_MS);

    expect(authService.pruneExpiredTokens).not.toHaveBeenCalled();
  });
});
