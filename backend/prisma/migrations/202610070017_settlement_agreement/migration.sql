-- AlterTable
ALTER TABLE "NotificationOutbox" ADD COLUMN     "firstAttemptAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "settlementAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "settlementProposedAt" TIMESTAMP(3),
ADD COLUMN     "settlementRetainedCents" INTEGER;
