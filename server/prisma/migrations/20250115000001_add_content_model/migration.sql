-- CreateEnum
CREATE TYPE "ContentPage" AS ENUM ('HOME', 'DREAM_POINTS', 'COOPERATION');

-- CreateEnum
CREATE TYPE "ContentSection" AS ENUM (
  'HOME_HERO',
  'HOME_UPCOMING_TRIPS',
  'HOME_HOW_IT_WORKS',
  'HOME_WHY_US',
  'HOME_NEWSLETTER',
  'DP_INTRO',
  'DP_HOW_MANY',
  'DP_VOUCHERS',
  'DP_WHY_ACCOUNT',
  'COOP_INTRO',
  'COOP_GALLERY',
  'COOP_CONTACT'
);

-- CreateTable
CREATE TABLE "Content" (
    "id" TEXT NOT NULL,
    "page" "ContentPage" NOT NULL,
    "section" "ContentSection" NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Content_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Content_section_key" ON "Content"("section");

-- CreateIndex
CREATE INDEX "Content_page_section_idx" ON "Content"("page", "section");

-- CreateIndex
CREATE INDEX "Content_section_idx" ON "Content"("section");

