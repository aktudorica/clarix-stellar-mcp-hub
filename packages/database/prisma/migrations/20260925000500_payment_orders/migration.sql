CREATE TABLE "PaymentOrder" (
 "id" UUID PRIMARY KEY, "workspaceId" UUID NOT NULL REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "createdBy" UUID NOT NULL, "serviceVersionId" UUID NOT NULL REFERENCES "ServiceVersion"("id") ON DELETE RESTRICT,
 "request" JSONB NOT NULL, "inputFingerprint" TEXT NOT NULL, "idempotencyKey" TEXT NOT NULL,
 "requirement" JSONB NOT NULL, "status" TEXT NOT NULL DEFAULT 'QUOTED',
 "payloadHash" TEXT UNIQUE, "transactionHash" TEXT UNIQUE, "settlement" JSONB,
 "executionId" UUID UNIQUE REFERENCES "Execution"("id") ON DELETE RESTRICT,
 "expiresAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "PaymentOrder_workspaceId_idempotencyKey_key" ON "PaymentOrder"("workspaceId", "idempotencyKey");
CREATE INDEX "PaymentOrder_workspaceId_status_idx" ON "PaymentOrder"("workspaceId", "status");
