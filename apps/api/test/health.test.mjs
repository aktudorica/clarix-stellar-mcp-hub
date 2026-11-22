import 'reflect-metadata';
import { jest, describe, it, expect, afterEach } from '@jest/globals';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { StatusController } from '../dist/status/status.controller.js';
import { StatusService } from '../dist/status/status.service.js';
import { DatabaseService, RedisService } from '@clarix/platform';

describe('readiness health contract', () => {
  let app;
  afterEach(async () => {
    await app?.close();
  });

  async function start(databaseAvailable, workerHeartbeat) {
    const database = {
      client: {
        $queryRaw: databaseAvailable
          ? jest.fn().mockResolvedValue([{ '?column?': 1 }])
          : jest.fn().mockRejectedValue(new Error('private connection details')),
      },
    };
    const redis = {
      client: {
        ping: jest.fn().mockResolvedValue('PONG'),
        get: jest.fn().mockResolvedValue(workerHeartbeat),
      },
    };
    const module = await Test.createTestingModule({
      controllers: [StatusController],
      providers: [
        StatusService,
        { provide: DatabaseService, useValue: database },
        { provide: RedisService, useValue: redis },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  }

  it('returns 503 when storage fails without leaking the connection error', async () => {
    await start(false, 'worker');
    const response = await request(app.getHttpServer()).get('/health/ready').expect(503);
    expect(response.body.checks.database.status).toBe('down');
    expect(JSON.stringify(response.body)).not.toContain('private connection');
    await request(app.getHttpServer()).get('/health/live').expect(200);
  });

  it('does not claim readiness when the worker heartbeat has expired', async () => {
    await start(true, null);
    const response = await request(app.getHttpServer()).get('/health/ready').expect(503);
    expect(response.body.checks.worker.status).toBe('down');
  });

  it('only advertises implemented features even when infrastructure is ready', async () => {
    await start(true, 'worker');
    const response = await request(app.getHttpServer()).get('/health/ready').expect(200);
    expect(response.body.features).toEqual({
      mcp: true,
      payments: false,
      agent: false,
      execution: process.env.EXECUTION_ACCESS === 'internal_preview',
    });
  });
});
