CREATE TABLE "AgentRun" (
 "id" UUID PRIMARY KEY, "workspaceId" UUID NOT NULL REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "createdBy" UUID NOT NULL, "prompt" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'RUNNING', "output" JSONB,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "finishedAt" TIMESTAMP(3)
);
CREATE INDEX "AgentRun_workspaceId_createdAt_idx" ON "AgentRun"("workspaceId", "createdAt");
