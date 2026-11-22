import { Controller, Get, HttpException, UseGuards } from '@nestjs/common';
import { StellarReader, AnalysisError } from '@clarix/stellar';
import { AuthGuard } from '../auth/auth.guard.js';

@Controller('api/stellar')
@UseGuards(AuthGuard)
export class StellarController {
  private readonly stellar = new StellarReader();
  @Get('examples')
  async examples() {
    try {
      return await this.stellar.examples();
    } catch (error) {
      throw new HttpException(
        error instanceof AnalysisError ? error.message : 'Unable to load a testnet example.',
        503,
      );
    }
  }
}
