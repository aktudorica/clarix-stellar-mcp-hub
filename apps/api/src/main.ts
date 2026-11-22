import { hostHeaderValidation } from '@modelcontextprotocol/express';
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import { AppLogger } from '@clarix/platform';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const logger = new AppLogger();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger,
    bodyParser: false,
  });
  app.use(helmet());
  app.use(
    '/api/mcp',
    hostHeaderValidation(
      (process.env.APP_ORIGINS ?? '')
        .split(',')
        .filter(Boolean)
        .map((value) => new URL(value).hostname),
    ),
  );
  app.useBodyParser('json', { limit: '32kb' });
  app.use((request: Request, response: Response, next: NextFunction) => {
    const requestId = randomUUID();
    const started = performance.now();
    response.setHeader('X-Request-Id', requestId);
    response.setHeader('Cache-Control', 'no-store');
    response.on('finish', () =>
      logger.log(
        JSON.stringify({
          requestId,
          method: request.method,
          path: request.path,
          status: response.statusCode,
          durationMs: Math.round(performance.now() - started),
        }),
        'HTTP',
      ),
    );
    next();
  });
  app.enableShutdownHooks();
  await app.listen(3000, '0.0.0.0');
}

bootstrap().catch(() => {
  console.error('API startup failed. Check database and Redis configuration.');
  process.exitCode = 1;
});
