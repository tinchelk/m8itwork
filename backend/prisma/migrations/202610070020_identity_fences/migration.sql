CREATE TABLE "ClosedIdentity" ("id" TEXT NOT NULL, "accountId" UUID NOT NULL, CONSTRAINT "ClosedIdentity_pkey" PRIMARY KEY ("id"));
ALTER TABLE "ClosedIdentity" ADD CONSTRAINT "ClosedIdentity_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
