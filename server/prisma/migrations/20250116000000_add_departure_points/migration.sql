-- CreateTable
CREATE TABLE "DeparturePoint" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'PLN',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeparturePoint_pkey" PRIMARY KEY ("id")
);

-- AlterTable
-- Zmiana priceCents na opcjonalne (dla kompatybilności wstecznej)
ALTER TABLE "Trip" ALTER COLUMN "priceCents" DROP NOT NULL;

-- AlterTable
-- Dodanie departurePointId do OrderItem (opcjonalne dla kompatybilności wstecznej)
ALTER TABLE "OrderItem" ADD COLUMN "departurePointId" TEXT;

-- CreateIndex
CREATE INDEX "DeparturePoint_tripId_isActive_idx" ON "DeparturePoint"("tripId", "isActive");

-- CreateIndex
CREATE INDEX "DeparturePoint_tripId_sortOrder_idx" ON "DeparturePoint"("tripId", "sortOrder");

-- CreateIndex
CREATE INDEX "OrderItem_departurePointId_idx" ON "OrderItem"("departurePointId");

-- AddForeignKey
ALTER TABLE "DeparturePoint" ADD CONSTRAINT "DeparturePoint_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_departurePointId_fkey" FOREIGN KEY ("departurePointId") REFERENCES "DeparturePoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

