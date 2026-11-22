import { Controller, Get, Inject, Param } from '@nestjs/common';
import { CatalogServiceRepository } from './catalog.service.js';

@Controller('api/services')
export class CatalogController {
  constructor(
    @Inject(CatalogServiceRepository) private readonly catalog: CatalogServiceRepository,
  ) {}
  @Get()
  async list() {
    return { data: await this.catalog.list() };
  }
  @Get(':slug')
  async find(@Param('slug') slug: string) {
    return { data: await this.catalog.find(slug) };
  }
}
