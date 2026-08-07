import 'reflect-metadata';

import { Logger, ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';

import { AppModule } from './app.module';
import type { AppConfig, SwaggerConfig } from './config/configuration';
import { setupSwagger } from './config/swagger.setup';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { isOriginAllowed } from './common/cors/origin-matcher';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });

  const configService = app.get(ConfigService);
  const { port, apiPrefix, apiVersion, corsOrigins } = configService.getOrThrow<AppConfig>('app');
  const swagger = configService.getOrThrow<SwaggerConfig>('swagger');

  /*
   * `crossOriginResourcePolicy` relaxed on purpose.
   *
   * Bare `helmet()` sends `Cross-Origin-Resource-Policy: same-origin`, and a
   * browser honours that *after* the CORS check passes — so a correctly
   * allow-listed origin still has the response withheld from it. The failure
   * surfaces as a blocked request, which reads like a CORS problem and is not
   * one. Only relevant because the API is consumed from another origin; behind
   * a same-origin proxy it would make no difference.
   */
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(compression());
  // Required: the JWT strategy and the auth controller read tokens from cookies.
  app.use(cookieParser());

  // Behind a proxy/load balancer this makes `request.ip` the real client IP,
  // which the rate limiter and session audit trail both depend on.
  app.set('trust proxy', 1);

  const corsLogger = new Logger('Cors');
  corsLogger.log(`Allowed origins: ${corsOrigins.join(', ') || '(none)'}`);

  // `credentials: true` with an explicit origin allow-list is what lets the
  // browser send our httpOnly auth cookies. `Access-Control-Allow-Origin: *`
  // is invalid alongside credentials, and that restriction is a large part of
  // the CSRF defense.
  app.enableCors({
    origin: (origin, callback) => {
      // No `Origin` header at all: curl, a health probe, or a server-to-server
      // call such as a Next.js rewrite. There is nothing to authorize and no
      // header to echo back.
      if (!origin) return callback(null, true);

      if (isOriginAllowed(origin, corsOrigins)) return callback(null, true);

      // Rejecting silently is why a misconfigured allow-list costs an evening:
      // the browser only says "preflight did not succeed" and the server says
      // nothing at all. Say it out loud, with both sides of the comparison.
      corsLogger.warn(
        `Blocked ${origin} — not in the allow-list [${corsOrigins.join(', ')}]. ` +
          'Set CORS_ORIGINS to the exact scheme + host, no trailing slash.',
      );

      // `false`, not an Error: the response is then a plain preflight without
      // the allow headers, which is what the spec expects. An Error would turn
      // it into a 500 and bury the reason.
      callback(null, false);
    },
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
  });

  // Probes stay off the versioned prefix so infra never has to track API versions.
  app.setGlobalPrefix(apiPrefix, {
    exclude: ['health', 'health/liveness', 'health/readiness'],
  });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: apiVersion });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      /**
       * Implicit conversion is OFF deliberately. For booleans it applies
       * `Boolean(value)`, so the string "false" arriving from a query string
       * or multipart form becomes `true` — and it runs *before* `@Transform`,
       * so a decorator cannot undo it. Every DTO converts explicitly instead:
       * `@Type(() => Number)` for numbers, `@ToBoolean()` for booleans.
       */
      transformOptions: { enableImplicitConversion: false },
      stopAtFirstError: false,
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());

  app.enableShutdownHooks();

  setupSwagger(app);

  // '0.0.0.0', not the default loopback-friendly bind: a container platform
  // reaches the process from outside the container, and a health check that
  // cannot connect is reported as "container stopped" rather than as a bind
  // problem.
  await app.listen(port, '0.0.0.0');

  const logger = new Logger('Bootstrap');
  logger.log(`MovieFlix API listening on http://localhost:${port}/${apiPrefix}/v${apiVersion}`);
  if (swagger.enabled) {
    logger.log(`OpenAPI docs on http://localhost:${port}/${swagger.path}`);
  }
}

void bootstrap();
