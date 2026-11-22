-- CreateEnum
CREATE TYPE "ExecutionStatus" AS ENUM ('QUEUED', 'RUNNING', 'RETRYING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workspace" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceMember" (
    "userId" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'OWNER',

    CONSTRAINT "WorkspaceMember_pkey" PRIMARY KEY ("userId","workspaceId")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "csrfToken" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceVersion" (
    "id" UUID NOT NULL,
    "serviceId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "implementation" TEXT NOT NULL,
    "inputSchema" JSONB NOT NULL,
    "outputSchema" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Execution" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "createdBy" UUID NOT NULL,
    "serviceVersionId" UUID NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "inputFingerprint" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "status" "ExecutionStatus" NOT NULL DEFAULT 'QUEUED',
    "accessMode" TEXT NOT NULL DEFAULT 'INTERNAL_PREVIEW',
    "result" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseToken" UUID,
    "leaseUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Execution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionAttempt" (
    "id" UUID NOT NULL,
    "executionId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "leaseToken" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "errorCode" TEXT,

    CONSTRAINT "ExecutionAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionEvent" (
    "id" BIGSERIAL NOT NULL,
    "executionId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExecutionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxMessage" (
    "id" UUID NOT NULL,
    "executionId" UUID NOT NULL,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispatchedAt" TIMESTAMP(3),
    "claimToken" UUID,
    "claimedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboxMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "WorkspaceMember_workspaceId_idx" ON "WorkspaceMember"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_workspaceId_idx" ON "Session"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceVersion_serviceId_version_key" ON "ServiceVersion"("serviceId", "version");

-- CreateIndex
CREATE INDEX "Execution_workspaceId_createdAt_id_idx" ON "Execution"("workspaceId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Execution_status_leaseUntil_idx" ON "Execution"("status", "leaseUntil");

-- CreateIndex
CREATE UNIQUE INDEX "Execution_workspaceId_idempotencyKey_key" ON "Execution"("workspaceId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "ExecutionAttempt_leaseToken_key" ON "ExecutionAttempt"("leaseToken");

-- CreateIndex
CREATE UNIQUE INDEX "ExecutionAttempt_executionId_number_key" ON "ExecutionAttempt"("executionId", "number");

-- CreateIndex
CREATE INDEX "ExecutionEvent_executionId_id_idx" ON "ExecutionEvent"("executionId", "id");

-- CreateIndex
CREATE INDEX "OutboxMessage_dispatchedAt_availableAt_claimedUntil_idx" ON "OutboxMessage"("dispatchedAt", "availableAt", "claimedUntil");

-- CreateIndex
CREATE INDEX "OutboxMessage_executionId_idx" ON "OutboxMessage"("executionId");

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceVersion" ADD CONSTRAINT "ServiceVersion_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "ServiceDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Execution" ADD CONSTRAINT "Execution_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Execution" ADD CONSTRAINT "Execution_serviceVersionId_fkey" FOREIGN KEY ("serviceVersionId") REFERENCES "ServiceVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionAttempt" ADD CONSTRAINT "ExecutionAttempt_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "Execution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionEvent" ADD CONSTRAINT "ExecutionEvent_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "Execution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboxMessage" ADD CONSTRAINT "OutboxMessage_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "Execution"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Published implementation contracts are append-only. A change requires a new version.
CREATE FUNCTION reject_service_version_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ServiceVersion is immutable; publish a new version';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER service_version_immutable BEFORE UPDATE ON "ServiceVersion"
FOR EACH ROW EXECUTE FUNCTION reject_service_version_update();

UPDATE "ServiceDefinition" SET "status" = 'ACTIVE'
WHERE "slug" IN ('analyze_account', 'explain_transaction') AND "status" = 'PLANNED';
