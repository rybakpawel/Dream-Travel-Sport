import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Seed script for database initialization.
 *
 * Currently empty - placeholder data from the frontend is not seeded.
 * Add your real trip data here when ready.
 */
async function main() {
  // Seed logic will go here when you have real trip data to add.
  console.log("Seed completed (no data to seed).");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });


