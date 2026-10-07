-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "notificationEmail" TEXT,
ADD COLUMN     "notificationVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "projectNotifications" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "acceptedAt" TIMESTAMP(3),
ADD COLUMN     "cancellationReason" TEXT,
ADD COLUMN     "cancellationRequestedAt" TIMESTAMP(3),
ADD COLUMN     "closedReason" TEXT,
ADD COLUMN     "settledAt" TIMESTAMP(3),
ADD COLUMN     "settlementSummary" TEXT;

-- AlterTable
ALTER TABLE "ProjectRequest" ADD COLUMN     "aftercareEligible" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "purpose" TEXT NOT NULL DEFAULT 'ADDITION',
ADD COLUMN     "reportedAgainstProposalId" UUID,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "triageReason" TEXT,
ADD COLUMN     "triagedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Proposal" ADD COLUMN     "conditions" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "RepositoryRevision" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "commit" TEXT NOT NULL,
    "report" JSONB NOT NULL,
    "reviewSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepositoryRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Handover" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "proposalId" UUID NOT NULL,
    "summary" TEXT NOT NULL,
    "artifacts" JSONB NOT NULL,
    "checks" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "limitations" TEXT NOT NULL,
    "deployment" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Handover_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationToken" (
    "id" TEXT NOT NULL,
    "accountId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationOutbox" (
    "id" TEXT NOT NULL,
    "accountId" UUID NOT NULL,
    "projectId" UUID,
    "kind" TEXT NOT NULL,
    "destination" TEXT,
    "verificationUrlEncrypted" TEXT,
    "sentAt" TIMESTAMP(3),
    "skippedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseUntil" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RepositoryRevision_projectId_commit_key" ON "RepositoryRevision"("projectId", "commit");

-- CreateIndex
CREATE UNIQUE INDEX "Handover_projectId_key" ON "Handover"("projectId");

-- CreateIndex
CREATE INDEX "NotificationToken_expiresAt_idx" ON "NotificationToken"("expiresAt");

-- CreateIndex
CREATE INDEX "NotificationOutbox_sentAt_skippedAt_nextAttemptAt_idx" ON "NotificationOutbox"("sentAt", "skippedAt", "nextAttemptAt");

-- AddForeignKey
ALTER TABLE "RepositoryRevision" ADD CONSTRAINT "RepositoryRevision_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Handover" ADD CONSTRAINT "Handover_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationToken" ADD CONSTRAINT "NotificationToken_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationOutbox" ADD CONSTRAINT "NotificationOutbox_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
