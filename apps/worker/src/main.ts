import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppLogger } from '@clarix/platform';
import { WorkerModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule, { logger: new AppLogger() });
  app.enableShutdownHooks();
}
bootstrap().catch(() => {
  console.error('Worker startup failed. Check service configuration.');
  process.exitCode = 1;
});
