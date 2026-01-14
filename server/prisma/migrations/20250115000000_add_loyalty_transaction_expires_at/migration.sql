-- AlterTable
ALTER TABLE "LoyaltyTransaction" ADD COLUMN     "expiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "LoyaltyTransaction_accountId_expiresAt_type_idx" ON "LoyaltyTransaction"("accountId", "expiresAt", "type");

-- CreateIndex
CREATE INDEX "LoyaltyTransaction_expiresAt_idx" ON "LoyaltyTransaction"("expiresAt");

