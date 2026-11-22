import { createDatabase } from './index.js';

const database = createDatabase();
try {
  await database.$transaction(async (tx) => {
    const provider = await tx.provider.upsert({
      where: { slug: 'stellarchain' },
      update: {},
      create: { slug: 'stellarchain', name: 'Clarix · StellarChain' },
    });
    const services = [
      {
        slug: 'analyze_account',
        name: 'Account intelligence',
        category: 'Accounts',
        description:
          'Understand a Stellar account through its balances, assets, trustlines and recent activity.',
        capabilities: ['Asset balances', 'Trustlines', 'Recent activity'],
      },
      {
        slug: 'explain_transaction',
        name: 'Transaction explorer',
        category: 'Transactions',
        description:
          'Turn a transaction hash into a clear breakdown of operations, transfers, fees and outcomes.',
        capabilities: ['Operation breakdown', 'Asset transfers', 'Execution outcome'],
      },
    ];
    for (const service of services) {
      const definition = await tx.serviceDefinition.upsert({
        where: { slug: service.slug },
        update: {},
        create: { ...service, providerId: provider.id, status: 'ACTIVE' },
      });
      await tx.serviceVersion.upsert({
        where: { serviceId_version: { serviceId: definition.id, version: 1 } },
        update: {},
        create: {
          serviceId: definition.id,
          version: 1,
          implementation: `stellar/${service.slug}@1`,
          inputSchema: {
            type: 'object',
            required: [service.slug === 'analyze_account' ? 'address' : 'hash'],
            properties:
              service.slug === 'analyze_account'
                ? { address: { type: 'string', pattern: '^G[A-Z2-7]{55}$' } }
                : { hash: { type: 'string', pattern: '^[a-fA-F0-9]{64}$' } },
            additionalProperties: false,
          },
          outputSchema: {
            type: 'object',
            required: ['type', 'summary', 'evidence'],
            properties: {
              type: { const: service.slug === 'analyze_account' ? 'account' : 'transaction' },
              summary: { type: 'string' },
              evidence: { type: 'object' },
            },
          },
        },
      });
    }
  });
  console.info('Catalog initialized; existing entries preserved.');
} finally {
  await database.$disconnect();
}
