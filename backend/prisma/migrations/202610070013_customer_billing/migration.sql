CREATE TABLE "BillingCustomer" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "mode" TEXT NOT NULL,
    "stripeCustomerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BillingCustomer_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "BillingCustomer_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "BillingCustomer_accountId_mode_key" ON "BillingCustomer"("accountId", "mode");
CREATE UNIQUE INDEX "BillingCustomer_stripeCustomerId_key" ON "BillingCustomer"("stripeCustomerId");
CREATE TABLE "BillingCardRemoval" (
    "id" UUID NOT NULL,
    "billingCustomerId" UUID NOT NULL,
    "methodId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BillingCardRemoval_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "BillingCardRemoval_billingCustomerId_fkey" FOREIGN KEY ("billingCustomerId") REFERENCES "BillingCustomer"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "BillingCardRemoval_billingCustomerId_methodId_key" ON "BillingCardRemoval"("billingCustomerId", "methodId");
ALTER TABLE "PaymentAttempt" ADD COLUMN "stripeCustomerId" TEXT,
    ADD COLUMN "invoiceUrl" TEXT,
    ADD COLUMN "invoicePdf" TEXT;
