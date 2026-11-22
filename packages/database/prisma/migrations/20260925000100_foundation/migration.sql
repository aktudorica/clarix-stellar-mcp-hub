CREATE TYPE "ServiceStatus" AS ENUM ('PLANNED', 'ACTIVE', 'DISABLED');

CREATE TABLE "Provider" (
  "id" UUID NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Provider_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ServiceDefinition" (
  "id" UUID NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "status" "ServiceStatus" NOT NULL DEFAULT 'PLANNED',
  "network" TEXT NOT NULL DEFAULT 'stellar:testnet',
  "capabilities" TEXT[] NOT NULL,
  "providerId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ServiceDefinition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SystemProbe" (
  "id" UUID NOT NULL,
  "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "workerId" TEXT NOT NULL,
  CONSTRAINT "SystemProbe_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Provider_slug_key" ON "Provider"("slug");
CREATE UNIQUE INDEX "ServiceDefinition_slug_key" ON "ServiceDefinition"("slug");
CREATE INDEX "ServiceDefinition_providerId_idx" ON "ServiceDefinition"("providerId");
CREATE INDEX "ServiceDefinition_status_category_idx" ON "ServiceDefinition"("status", "category");
ALTER TABLE "ServiceDefinition" ADD CONSTRAINT "ServiceDefinition_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
