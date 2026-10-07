ALTER TABLE "Account" ADD COLUMN "closedAt" TIMESTAMP(3);
CREATE TABLE "AccountClosure" (
  "id" TEXT NOT NULL,
  "accountId" UUID NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccountClosure_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AccountClosure_accountId_key" ON "AccountClosure"("accountId");
CREATE INDEX "AccountClosure_expiresAt_idx" ON "AccountClosure"("expiresAt");
ALTER TABLE "AccountClosure" ADD CONSTRAINT "AccountClosure_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
