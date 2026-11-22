import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '@clarix/platform';
import type { CatalogService } from '@clarix/contracts';

const publicService = {
  id: true,
  slug: true,
  name: true,
  description: true,
  category: true,
  status: true,
  network: true,
  capabilities: true,
  provider: { select: { name: true, slug: true } },
} as const;

@Injectable()
export class CatalogServiceRepository {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async list(): Promise<CatalogService[]> {
    return this.database.client.serviceDefinition.findMany({
      where: { status: { not: 'DISABLED' } },
      select: publicService,
      orderBy: { slug: 'asc' },
    });
  }

  async find(slug: string): Promise<CatalogService> {
    const service = await this.database.client.serviceDefinition.findFirst({
      where: { slug, status: { not: 'DISABLED' } },
      select: publicService,
    });
    if (!service) throw new NotFoundException('Service not found');
    return service;
  }
}
