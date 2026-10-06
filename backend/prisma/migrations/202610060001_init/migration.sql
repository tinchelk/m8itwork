CREATE TABLE "ReviewSession" (
  "id" TEXT PRIMARY KEY, "expiresAt" TIMESTAMP(3) NOT NULL,
  "oauthStateHash" TEXT, "oauthExpiresAt" TIMESTAMP(3), "verifierEncrypted" TEXT,
  "tokenEncrypted" TEXT, "tokenExpiresAt" TIMESTAMP(3), "githubLogin" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "ReviewSession_oauthStateHash_key" ON "ReviewSession"("oauthStateHash");
CREATE INDEX "ReviewSession_expiresAt_idx" ON "ReviewSession"("expiresAt");
CREATE TABLE "Inspection" (
  "id" UUID PRIMARY KEY, "sessionId" TEXT NOT NULL, "report" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Inspection_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ReviewSession"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "Inspection_sessionId_createdAt_idx" ON "Inspection"("sessionId", "createdAt");
CREATE TABLE "Submission" (
  "id" UUID PRIMARY KEY, "name" TEXT NOT NULL, "email" TEXT NOT NULL, "projectName" TEXT NOT NULL,
  "platform" TEXT NOT NULL, "demoUrl" TEXT, "problem" TEXT NOT NULL, "workflows" TEXT[] NOT NULL,
  "inspectionReport" JSONB, "status" TEXT NOT NULL DEFAULT 'NEW',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "Submission_createdAt_idx" ON "Submission"("createdAt");
