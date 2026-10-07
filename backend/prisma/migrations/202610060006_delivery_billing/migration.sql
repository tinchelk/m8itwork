-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "customerLastMessageAt" TIMESTAMP(3),
ADD COLUMN     "customerReadAt" TIMESTAMP(3),
ADD COLUMN     "teamLastMessageAt" TIMESTAMP(3),
ADD COLUMN     "teamReadAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ProjectMessage" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "authorRole" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamNote" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "authorName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkItem" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'TODO',
    "evidence" TEXT,
    "evidenceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentMilestone" (
    "id" UUID NOT NULL,
    "proposalId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "dueWhen" TEXT NOT NULL,
    "releasedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "paidCents" INTEGER NOT NULL DEFAULT 0,
    "refundedCents" INTEGER NOT NULL DEFAULT 0,
    "disputed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PaymentMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAttempt" (
    "id" UUID NOT NULL,
    "milestoneId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CREATING',
    "mode" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "stripeSessionId" TEXT,
    "stripePaymentIntentId" TEXT,
    "checkoutUrl" TEXT,
    "receiptUrl" TEXT,
    "refundedCents" INTEGER NOT NULL DEFAULT 0,
    "disputed" BOOLEAN NOT NULL DEFAULT false,
    "disputeEventCreated" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectMessage_projectId_createdAt_id_idx" ON "ProjectMessage"("projectId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "TeamNote_projectId_createdAt_idx" ON "TeamNote"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkItem_projectId_createdAt_idx" ON "WorkItem"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentMilestone_proposalId_position_key" ON "PaymentMilestone"("proposalId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttempt_stripeSessionId_key" ON "PaymentAttempt"("stripeSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttempt_stripePaymentIntentId_key" ON "PaymentAttempt"("stripePaymentIntentId");

-- CreateIndex
CREATE INDEX "PaymentAttempt_milestoneId_createdAt_idx" ON "PaymentAttempt"("milestoneId", "createdAt");

-- AddForeignKey
ALTER TABLE "ProjectMessage" ADD CONSTRAINT "ProjectMessage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamNote" ADD CONSTRAINT "TeamNote_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItem" ADD CONSTRAINT "WorkItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentMilestone" ADD CONSTRAINT "PaymentMilestone_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "PaymentMilestone"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Preserve existing proposals as a single upfront installment. No historical
-- payment is inferred; their payment gate stays closed until Stripe confirms.
INSERT INTO "PaymentMilestone" ("id", "proposalId", "position", "label", "amountCents", "dueWhen", "releasedAt")
SELECT gen_random_uuid(), "id", 0, 'Project payment', "amountCents", 'BEFORE_BUILD', "approvedAt" FROM "Proposal";
