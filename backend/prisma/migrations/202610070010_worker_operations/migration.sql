ALTER TABLE "ReviewWorker" ADD COLUMN "providerStatus" JSONB, ADD COLUMN "statusAt" TIMESTAMP(3);
ALTER TABLE "ReviewJob" ADD COLUMN "instructions" TEXT, ADD COLUMN "previousTurns" JSONB,
  ADD COLUMN "parentJobId" UUID, ADD COLUMN "activity" JSONB, ADD COLUMN "activityOmitted" INTEGER NOT NULL DEFAULT 0;
