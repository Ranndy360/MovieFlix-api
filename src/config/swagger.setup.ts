import { type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import type { AppConfig, SwaggerConfig } from './configuration';

/**
 * Mounts OpenAPI docs at `${swagger.path}` and the raw contract at
 * `${swagger.path}-json`, which the frontend can codegen against.
 */
export function setupSwagger(app: INestApplication): void {
  const configService = app.get(ConfigService);
  const swagger = configService.getOrThrow<SwaggerConfig>('swagger');
  const appCfg = configService.getOrThrow<AppConfig>('app');

  if (!swagger.enabled) {
    return;
  }

  const documentConfig = new DocumentBuilder()
    .setTitle('MovieFlix API')
    .setDescription('HTTP contract for the MovieFlix catalog service.')
    .setVersion(appCfg.apiVersion)
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', in: 'header' },
      'access-token',
    )
    .addServer(`http://localhost:${appCfg.port}`, 'Local')
    .addTag('health', 'Liveness and readiness probes')
    .addTag('movies', 'Movie catalog management')
    .build();

  const document = SwaggerModule.createDocument(app, documentConfig, {
    operationIdFactory: (_controllerKey, methodKey) => methodKey,
  });

  SwaggerModule.setup(swagger.path, app, document, {
    jsonDocumentUrl: `${swagger.path}-json`,
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
  });
}
