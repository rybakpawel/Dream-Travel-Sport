/*
  Warnings:

  - You are about to drop the column `match` on the `Trip` table. All the data in the column will be lost.
  - Made the column `startsAt` on table `Trip` required. This step will fail if there are existing NULL values in that column.
  - Made the column `endsAt` on table `Trip` required. This step will fail if there are existing NULL values in that column.
  - Made the column `capacity` on table `Trip` required. This step will fail if there are existing NULL values in that column.
  - Made the column `seatsLeft` on table `Trip` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Trip" DROP COLUMN "match",
ALTER COLUMN "startsAt" SET NOT NULL,
ALTER COLUMN "endsAt" SET NOT NULL,
ALTER COLUMN "capacity" SET NOT NULL,
ALTER COLUMN "seatsLeft" SET NOT NULL;
