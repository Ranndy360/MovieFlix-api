import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { Request, Response } from 'express';
import { ConnectionError, BaseError as SequelizeBaseError, UniqueConstraintError } from 'sequelize';

/** Everything at or above this is our fault and gets logged with a stack. */
const SERVER_ERROR_THRESHOLD: number = HttpStatus.INTERNAL_SERVER_ERROR;

export interface ErrorResponseBody {
  statusCode: number;
  message: string | string[];
  error: string;
  path: string;
  method: string;
  timestamp: string;
}

/**
 * Normalizes every thrown value into one response shape so clients never have
 * to branch on where an error came from. Driver-level Sequelize errors are
 * translated here and never leaked verbatim.
 */
@Catch()
export class AllExceptionsFilter extends BaseExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  override catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { status, message, error } = this.describe(exception);

    const body: ErrorResponseBody = {
      statusCode: status,
      message,
      error,
      path: request.url,
      method: request.method,
      timestamp: new Date().toISOString(),
    };

    if (status >= SERVER_ERROR_THRESHOLD) {
      this.logger.error(
        `${request.method} ${request.url} -> ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(`${request.method} ${request.url} -> ${status}: ${String(message)}`);
    }

    response.status(status).json(body);
  }

  private describe(exception: unknown): {
    status: number;
    message: string | string[];
    error: string;
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();

      if (typeof payload === 'string') {
        return { status, message: payload, error: exception.name };
      }

      const record = payload as { message?: string | string[]; error?: string };
      return {
        status,
        message: record.message ?? exception.message,
        error: record.error ?? exception.name,
      };
    }

    if (exception instanceof UniqueConstraintError) {
      return {
        status: HttpStatus.CONFLICT,
        message: exception.errors.map((e) => `${e.path ?? 'field'} must be unique`),
        error: 'Conflict',
      };
    }

    // The database being unreachable is our problem, not a bad request:
    // 503 tells the client (and any load balancer) that a retry may work.
    if (exception instanceof ConnectionError) {
      return {
        status: HttpStatus.SERVICE_UNAVAILABLE,
        message: 'The service is temporarily unavailable.',
        error: 'Service Unavailable',
      };
    }

    if (exception instanceof SequelizeBaseError) {
      return {
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        message: 'The request could not be processed.',
        error: 'Unprocessable Entity',
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
      error: 'Internal Server Error',
    };
  }
}
