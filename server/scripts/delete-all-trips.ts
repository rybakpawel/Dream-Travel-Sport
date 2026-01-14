import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function deleteAllTrips() {
  try {
    console.log("Łączenie z bazą danych...");
    
    // Sprawdź ile jest rekordów
    const count = await prisma.trip.count();
    console.log(`Znaleziono ${count} rekordów Trip w bazie danych.`);
    
    if (count === 0) {
      console.log("Brak rekordów do usunięcia.");
      await prisma.$disconnect();
      return;
    }
    
    // Usuń wszystkie rekordy
    const result = await prisma.trip.deleteMany({});
    console.log(`Usunięto ${result.count} rekordów Trip.`);
    
    await prisma.$disconnect();
    console.log("Gotowe!");
  } catch (error) {
    console.error("Błąd podczas usuwania rekordów:", error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

deleteAllTrips();

