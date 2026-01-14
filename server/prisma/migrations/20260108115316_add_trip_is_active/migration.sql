-- AlterTable
ALTER TABLE "Trip" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "Trip_isActive_idx" ON "Trip"("isActive");
