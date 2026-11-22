import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import { StatusService } from './status.service.js';

@Controller()
export class StatusController {
  constructor(@Inject(StatusService) private readonly status: StatusService) {}

  @Get('health/live')
  live() {
    return { status: 'alive' };
  }

  @Get('health/ready')
  async ready(@Res({ passthrough: true }) response: Response) {
    const status = await this.status.getStatus();
    response.status(status.status === 'ready' ? 200 : 503);
    return status;
  }

  @Get('api/status')
  getStatus() {
    return this.status.getStatus();
  }
}
