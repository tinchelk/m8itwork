ALTER TABLE "Project" ADD COLUMN "aiReviewConsentAt" TIMESTAMP(3), ADD COLUMN "aiReviewConsentVersion" TEXT;
CREATE TABLE "ReviewWorker" (
  "id" UUID NOT NULL, "name" TEXT NOT NULL, "tokenHash" TEXT NOT NULL,
  "operatorId" UUID NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3), "revokedAt" TIMESTAMP(3),
  CONSTRAINT "ReviewWorker_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ReviewWorker_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ReviewWorker_tokenHash_key" ON "ReviewWorker"("tokenHash");
CREATE TABLE "ReviewJob" (
  "id" UUID NOT NULL, "projectId" UUID NOT NULL, "provider" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'QUEUED', "commit" TEXT NOT NULL, "repositoryUrl" TEXT NOT NULL, "inputDigest" TEXT NOT NULL,
  "requestSnapshot" JSONB NOT NULL, "attemptId" UUID, "attempts" INTEGER NOT NULL DEFAULT 0,
  "workerId" UUID, "startedAt" TIMESTAMP(3), "leaseExpiresAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3), "sourceSessionId" TEXT,
  "sourceConnectionHash" TEXT,
  "evidencePaths" JSONB, "coverage" JSONB, "result" JSONB,
  "errorCode" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReviewJob_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ReviewJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ReviewJob_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "ReviewWorker"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ReviewJob_provider_check" CHECK ("provider" IN ('codex','claude')),
  CONSTRAINT "ReviewJob_status_check" CHECK ("status" IN ('QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELLED')),
  CONSTRAINT "ReviewJob_attempts_check" CHECK ("attempts" BETWEEN 0 AND 3)
);
CREATE UNIQUE INDEX "ReviewJob_attemptId_key" ON "ReviewJob"("attemptId");
CREATE UNIQUE INDEX "ReviewJob_active_project" ON "ReviewJob"("projectId") WHERE "status" IN ('QUEUED','RUNNING');
CREATE INDEX "ReviewJob_status_createdAt_idx" ON "ReviewJob"("status", "createdAt");
CREATE INDEX "ReviewJob_projectId_createdAt_idx" ON "ReviewJob"("projectId", "createdAt");
