import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { AuthService, type AuthenticatedRequest } from './auth.service.js';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    request.session = await this.auth.authenticate(request);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method))
      this.auth.checkCsrf(request, request.session);
    return true;
  }
}
