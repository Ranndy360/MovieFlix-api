import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';

/**
 * Emits one structured line per request with its latency. Kept deliberately
 * thin: anything richer belongs in a real APM exporter, not here.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const startedAt = process.hrtime.bigint();

    return next.handle().pipe(
      tap({
        next: () => this.write(request, http.getResponse<Response>().statusCode, startedAt),
        error: () => this.write(request, 500, startedAt),
      }),
    );
  }

  private write(request: Request, statusCode: number, startedAt: bigint): void {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    this.logger.log(`${request.method} ${request.url} ${statusCode} ${durationMs.toFixed(1)}ms`);
  }
}
