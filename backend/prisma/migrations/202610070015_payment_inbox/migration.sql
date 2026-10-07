-- CreateTable
CREATE TABLE "PaymentInbox" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "paymentIntentId" TEXT,
    "sessionId" TEXT,
    "attemptId" UUID,
    "refundedCents" INTEGER,
    "eventCreated" INTEGER NOT NULL,
    "processedAt" TIMESTAMP(3),
    "ignoredAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentInbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentInbox_processedAt_ignoredAt_nextAttemptAt_idx" ON "PaymentInbox"("processedAt", "ignoredAt", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "PaymentInbox_paymentIntentId_mode_idx" ON "PaymentInbox"("paymentIntentId", "mode");

-- CreateIndex
CREATE INDEX "PaymentInbox_attemptId_idx" ON "PaymentInbox"("attemptId");

-- AddForeignKey
ALTER TABLE "PaymentInbox" ADD CONSTRAINT "PaymentInbox_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "PaymentAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
