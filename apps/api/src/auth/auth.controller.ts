import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService, type AuthenticatedRequest } from './auth.service.js';
import { AuthGuard } from './auth.guard.js';

@Controller('api/auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  @Get('configuration')
  configuration() {
    return { registration: process.env.ALLOW_REGISTRATION === 'true' };
  }
  @Post('register')
  register(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.auth.register(body, request, response);
  }
  @Post('login')
  @HttpCode(200)
  login(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.auth.login(body, request, response);
  }
  @Get('session')
  @UseGuards(AuthGuard)
  session(@Req() request: AuthenticatedRequest) {
    return this.auth.view(request.session);
  }
  @Post('logout')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  logout(@Req() request: AuthenticatedRequest, @Res({ passthrough: true }) response: Response) {
    return this.auth.logout(request.session, response, request);
  }
}
