-- AlterTable
ALTER TABLE "Trip" ADD COLUMN "extendedDescription" TEXT NOT NULL DEFAULT '';

-- Migrate existing data: copy details to extendedDescription for existing trips
UPDATE "Trip" SET "extendedDescription" = "details" WHERE "extendedDescription" = '';

