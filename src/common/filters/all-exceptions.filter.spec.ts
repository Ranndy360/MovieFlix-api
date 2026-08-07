import {
  type ArgumentsHost,
  BadRequestException,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ConnectionRefusedError,
  DatabaseError,
  UniqueConstraintError,
  type ValidationErrorItem,
} from 'sequelize';

import { AllExceptionsFilter, type ErrorResponseBody } from './all-exceptions.filter';

const buildHost = (
  url = '/api/v1/movies',
  method = 'GET',
): { host: ArgumentsHost; json: jest.Mock; status: jest.Mock } => {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });

  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({ url, method }),
    }),
  } as unknown as ArgumentsHost;

  return { host, json, status };
};

const bodyOf = (json: jest.Mock): ErrorResponseBody => json.mock.calls[0][0] as ErrorResponseBody;

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;

  beforeEach(() => {
    filter = new AllExceptionsFilter();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  it('preserves the status and message of an HttpException', () => {
    const { host, json, status } = buildHost();

    filter.catch(new NotFoundException('Movie not found'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(bodyOf(json)).toMatchObject({
      statusCode: 404,
      message: 'Movie not found',
      path: '/api/v1/movies',
      method: 'GET',
    });
  });

  it('keeps the array of messages produced by ValidationPipe', () => {
    const { host, json } = buildHost();

    filter.catch(
      new BadRequestException({
        statusCode: 400,
        message: ['title must be a string', 'genre must be a valid enum value'],
        error: 'Bad Request',
      }),
      host,
    );

    expect(bodyOf(json).message).toEqual([
      'title must be a string',
      'genre must be a valid enum value',
    ]);
    expect(bodyOf(json).error).toBe('Bad Request');
  });

  it('handles an HttpException carrying a plain string payload', () => {
    const { host, json } = buildHost();

    filter.catch(new HttpException('teapot', HttpStatus.I_AM_A_TEAPOT), host);

    expect(bodyOf(json)).toMatchObject({ statusCode: 418, message: 'teapot' });
  });

  it('maps a unique-constraint violation to 409', () => {
    const { host, json, status } = buildHost('/api/v1/movies', 'POST');
    // Only `path` is read by the filter; the real ctor demands a live Model.
    const error = new UniqueConstraintError({
      errors: [{ path: 'title' } as ValidationErrorItem],
    });

    filter.catch(error, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(bodyOf(json).message).toEqual(['title must be unique']);
  });

  it('maps an unreachable database to 503, not 4xx', () => {
    const { host, json, status } = buildHost();

    filter.catch(new ConnectionRefusedError(new Error('ECONNREFUSED 127.0.0.1:5432')), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    expect(bodyOf(json).message).toBe('The service is temporarily unavailable.');
    expect(JSON.stringify(bodyOf(json))).not.toContain('127.0.0.1');
  });

  it('maps any other Sequelize error to 422 without leaking SQL', () => {
    const { host, json, status } = buildHost();
    const error = new DatabaseError(
      Object.assign(new Error('relation "movies" does not exist'), { sql: 'SELECT * FROM movies' }),
    );

    filter.catch(error, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(JSON.stringify(bodyOf(json))).not.toContain('SELECT');
  });

  it('masks an unknown error as a generic 500', () => {
    const { host, json, status } = buildHost();

    filter.catch(new Error('connection string: postgres://user:secret@host'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(bodyOf(json).message).toBe('Internal server error');
    expect(JSON.stringify(bodyOf(json))).not.toContain('secret');
  });

  it('masks a non-Error throw as a generic 500', () => {
    const { host, json, status } = buildHost();

    filter.catch('something odd', host);

    expect(status).toHaveBeenCalledWith(500);
    expect(bodyOf(json).error).toBe('Internal Server Error');
  });

  it('logs 5xx with a stack and 4xx as a warning', () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error');
    const warnSpy = jest.spyOn(Logger.prototype, 'warn');

    filter.catch(new Error('boom'), buildHost().host);
    expect(errorSpy).toHaveBeenCalledTimes(1);

    filter.catch(new NotFoundException('nope'), buildHost().host);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('always includes an ISO timestamp', () => {
    const { host, json } = buildHost();

    filter.catch(new NotFoundException(), host);

    expect(bodyOf(json).timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
