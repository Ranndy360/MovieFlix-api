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

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });

  const configService = app.get(ConfigService);
  const { port, apiPrefix, apiVersion, corsOrigins } = configService.getOrThrow<AppConfig>('app');
  const swagger = configService.getOrThrow<SwaggerConfig>('swagger');

  app.use(helmet());
  app.use(compression());
  // Required: the JWT strategy and the auth controller read tokens from cookies.
  app.use(cookieParser());

  // Behind a proxy/load balancer this makes `request.ip` the real client IP,
  // which the rate limiter and session audit trail both depend on.
  app.set('trust proxy', 1);

  // `credentials: true` with an explicit origin allow-list is what lets the
  // browser send our httpOnly auth cookies. A wildcard origin is invalid here,
  // and that restriction is a large part of the CSRF defense.
  app.enableCors({
    origin: corsOrigins,
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

  await app.listen(port);

  const logger = new Logger('Bootstrap');
  logger.log(`MovieFlix API listening on http://localhost:${port}/${apiPrefix}/v${apiVersion}`);
  if (swagger.enabled) {
    logger.log(`OpenAPI docs on http://localhost:${port}/${swagger.path}`);
  }
}

void bootstrap();
