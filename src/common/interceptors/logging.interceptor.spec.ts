import { type CallHandler, type ExecutionContext, Logger } from '@nestjs/common';
import { lastValueFrom, of, throwError, type Observable } from 'rxjs';

import { LoggingInterceptor } from './logging.interceptor';

const buildContext = (type: 'http' | 'rpc' = 'http', statusCode = 200): ExecutionContext =>
  ({
    getType: () => type,
    switchToHttp: () => ({
      getRequest: () => ({ method: 'GET', url: '/api/v1/movies' }),
      getResponse: () => ({ statusCode }),
    }),
  }) as unknown as ExecutionContext;

const handlerOf = (observable: Observable<unknown>): CallHandler =>
  ({ handle: () => observable }) as CallHandler;

describe('LoggingInterceptor', () => {
  let interceptor: LoggingInterceptor;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    interceptor = new LoggingInterceptor();
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  it('logs method, url, status and duration on success', async () => {
    await lastValueFrom(interceptor.intercept(buildContext('http', 201), handlerOf(of('ok'))));

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toMatch(/^GET \/api\/v1\/movies 201 \d+\.\dms$/);
  });

  it('passes the handler value through untouched', async () => {
    const payload = { id: 'abc' };

    await expect(
      lastValueFrom(interceptor.intercept(buildContext(), handlerOf(of(payload)))),
    ).resolves.toBe(payload);
  });

  it('logs a 500 when the handler errors and rethrows', async () => {
    const failing = { handle: () => throwError(() => new Error('boom')) } as CallHandler;

    await expect(lastValueFrom(interceptor.intercept(buildContext(), failing))).rejects.toThrow(
      'boom',
    );
    expect(logSpy.mock.calls[0][0]).toContain(' 500 ');
  });

  it('is a no-op for non-http contexts', async () => {
    await lastValueFrom(interceptor.intercept(buildContext('rpc'), handlerOf(of('ok'))));

    expect(logSpy).not.toHaveBeenCalled();
  });
});
