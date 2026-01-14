/**
 * Skrypt migracyjny dla istniejących danych Dream Points.
 * 
 * Uruchom po zastosowaniu migracji add_loyalty_transaction_expires_at:
 * npx tsx prisma/migrate-existing-loyalty-points.ts
 * 
 * Skrypt:
 * 1. Ustawia expiresAt dla wszystkich istniejących transakcji EARN (createdAt + 1 rok)
 * 2. Przelicza pointsBalance dla wszystkich kont używając nowej logiki z datami ważności
 */

import { PrismaClient, LoyaltyTxnType } from "@prisma/client";
import { getAvailablePoints, calculateExpirationDate } from "../src/services/loyalty.js";

const prisma = new PrismaClient();

async function migrateExistingLoyaltyPoints() {
  console.log("🚀 Rozpoczynam migrację istniejących danych Dream Points...\n");

  try {
    // 1. Znajdź wszystkie transakcje EARN bez expiresAt
    const earnTransactions = await prisma.loyaltyTransaction.findMany({
      where: {
        type: LoyaltyTxnType.EARN,
        expiresAt: null
      },
      select: {
        id: true,
        createdAt: true,
        accountId: true
      }
    });

    console.log(`📊 Znaleziono ${earnTransactions.length} transakcji EARN bez expiresAt`);

    // 2. Ustaw expiresAt dla każdej transakcji EARN
    let updatedCount = 0;
    for (const txn of earnTransactions) {
      const expiresAt = calculateExpirationDate(txn.createdAt);
      
      await prisma.loyaltyTransaction.update({
        where: { id: txn.id },
        data: { expiresAt }
      });
      
      updatedCount++;
      if (updatedCount % 100 === 0) {
        console.log(`  ✓ Zaktualizowano ${updatedCount}/${earnTransactions.length} transakcji...`);
      }
    }

    console.log(`✅ Zaktualizowano ${updatedCount} transakcji EARN z datami wygaśnięcia\n`);

    // 3. Znajdź wszystkie konta lojalnościowe
    const accounts = await prisma.loyaltyAccount.findMany({
      select: {
        id: true,
        userId: true,
        pointsBalance: true
      }
    });

    console.log(`📊 Znaleziono ${accounts.length} kont lojalnościowych`);
    console.log("🔄 Przeliczam saldo punktów dla każdego konta...\n");

    // 4. Przelicz pointsBalance dla każdego konta
    let recalculatedCount = 0;
    for (const account of accounts) {
      const availablePoints = await getAvailablePoints(prisma, account.id);
      
      // Aktualizuj tylko jeśli różni się od obecnego salda
      if (availablePoints !== account.pointsBalance) {
        await prisma.loyaltyAccount.update({
          where: { id: account.id },
          data: { pointsBalance: availablePoints }
        });
        
        console.log(
          `  ✓ Konto ${account.id}: ${account.pointsBalance} → ${availablePoints} punktów`
        );
        recalculatedCount++;
      }
    }

    console.log(`\n✅ Przeliczono saldo dla ${recalculatedCount} kont`);
    console.log("\n🎉 Migracja zakończona pomyślnie!");

  } catch (error) {
    console.error("\n❌ Błąd podczas migracji:", error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Uruchom migrację
migrateExistingLoyaltyPoints()
  .then(() => {
    console.log("\n✨ Gotowe!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n💥 Migracja nie powiodła się:", error);
    process.exit(1);
  });

