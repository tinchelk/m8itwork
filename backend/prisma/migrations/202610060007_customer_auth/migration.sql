ALTER TABLE "Account" ALTER COLUMN "githubId" DROP NOT NULL;
ALTER TABLE "Account" ALTER COLUMN "githubLogin" DROP NOT NULL;
ALTER TABLE "Account" ADD COLUMN "email" TEXT,
  ADD COLUMN "emailVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "passwordHash" TEXT,
  ADD COLUMN "googleId" TEXT;
CREATE UNIQUE INDEX "Account_email_key" ON "Account"("email");
CREATE UNIQUE INDEX "Account_googleId_key" ON "Account"("googleId");
ALTER TABLE "ReviewSession" ADD COLUMN "oauthNonceHash" TEXT;
CREATE TABLE "AccountToken" (
  "id" TEXT NOT NULL,
  "accountId" UUID NOT NULL,
  "purpose" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccountToken_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AccountToken_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "AccountToken_accountId_purpose_idx" ON "AccountToken"("accountId", "purpose");
CREATE INDEX "AccountToken_expiresAt_idx" ON "AccountToken"("expiresAt");
CREATE TABLE "AuthThrottle" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "count" INTEGER NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "AuthThrottle_expiresAt_idx" ON "AuthThrottle"("expiresAt");
