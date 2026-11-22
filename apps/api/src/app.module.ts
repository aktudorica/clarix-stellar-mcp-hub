import { PaymentService } from './integrations/payment.service.js';
import { AgentService } from './integrations/agent.service.js';
import { IntegrationsController } from './integrations/integrations.controller.js';
import { McpService } from './integrations/mcp.service.js';
import { Module } from '@nestjs/common';
import { PlatformModule } from '@clarix/platform';
import { StatusController } from './status/status.controller.js';
import { StatusService } from './status/status.service.js';
import { CatalogController } from './catalog/catalog.controller.js';
import { CatalogServiceRepository } from './catalog/catalog.service.js';
import { ExecutionService } from '@clarix/application';
import { AuthService } from './auth/auth.service.js';
import { AuthGuard } from './auth/auth.guard.js';
import { AuthController } from './auth/auth.controller.js';
import { ExecutionsController } from './executions/executions.controller.js';
import { StellarController } from './stellar/stellar.controller.js';

@Module({
  imports: [PlatformModule],
  controllers: [
    IntegrationsController,
    StatusController,
    CatalogController,
    AuthController,
    ExecutionsController,
    StellarController,
  ],
  providers: [
    PaymentService,
    AgentService,
    McpService,
    StatusService,
    CatalogServiceRepository,
    AuthService,
    AuthGuard,
    ExecutionService,
  ],
})
export class AppModule {}
