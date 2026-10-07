-- AlterTable
ALTER TABLE "Inspection" ADD COLUMN     "accountId" UUID;

-- CreateIndex
CREATE INDEX "Inspection_accountId_idx" ON "Inspection"("accountId");

-- AddForeignKey
ALTER TABLE "Inspection" ADD CONSTRAINT "Inspection_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

