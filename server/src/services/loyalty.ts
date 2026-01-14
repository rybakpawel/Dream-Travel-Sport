import { LoyaltyTxnType, PrismaClient } from "@prisma/client";

/**
 * Oblicza datę wygaśnięcia punktów (createdAt + 1 rok).
 */
export function calculateExpirationDate(createdAt: Date): Date {
  const expiresAt = new Date(createdAt);
  expiresAt.setFullYear(expiresAt.getFullYear() + 1);
  return expiresAt;
}

/**
 * Oblicza dostępną liczbę punktów dla konta lojalnościowego,
 * uwzględniając daty ważności (FIFO - najstarsze punkty najpierw).
 *
 * @param prisma - Instancja PrismaClient
 * @param accountId - ID konta lojalnościowego
 * @param asOfDate - Data, względem której sprawdzamy ważność (domyślnie: teraz)
 * @returns Dostępna liczba punktów
 */
export async function getAvailablePoints(
  prisma: PrismaClient,
  accountId: string,
  asOfDate: Date = new Date()
): Promise<number> {
  // Pobierz wszystkie transakcje EARN z ważnymi punktami (expiresAt > asOfDate lub null)
  // Sortuj po expiresAt ASC (najstarsze najpierw) lub createdAt ASC jeśli expiresAt jest null
  const earnTransactions = await prisma.loyaltyTransaction.findMany({
    where: {
      accountId,
      type: LoyaltyTxnType.EARN,
      OR: [
        { expiresAt: { gt: asOfDate } },
        { expiresAt: null } // Dla starych transakcji bez expiresAt (backward compatibility)
      ]
    },
    orderBy: [
      { expiresAt: "asc" },
      { createdAt: "asc" } // Fallback dla null expiresAt
    ],
    select: {
      id: true,
      points: true,
      expiresAt: true,
      createdAt: true
    }
  });

  // Pobierz wszystkie transakcje SPEND, posortowane chronologicznie
  const spendTransactions = await prisma.loyaltyTransaction.findMany({
    where: {
      accountId,
      type: LoyaltyTxnType.SPEND
    },
    orderBy: {
      createdAt: "asc"
    },
    select: {
      id: true,
      points: true, // ujemne wartości
      createdAt: true
    }
  });

  // Oblicz dostępne punkty używając FIFO
  // Symulujemy użycie punktów: każda transakcja SPEND zużywa najstarsze dostępne punkty EARN
  let availablePoints = 0;
  let remainingSpend = spendTransactions.reduce((sum, t) => sum + Math.abs(t.points), 0);

  // Dla każdej transakcji EARN (posortowanej od najstarszej)
  for (const earn of earnTransactions) {
    const earnedPoints = earn.points;

    if (remainingSpend <= 0) {
      // Wszystkie SPEND zostały już przydzielone, dodaj wszystkie punkty z tej transakcji EARN
      availablePoints += earnedPoints;
    } else {
      // Część lub wszystkie punkty z tej transakcji EARN zostały zużyte
      const usedFromThisEarn = Math.min(earnedPoints, remainingSpend);
      remainingSpend -= usedFromThisEarn;
      availablePoints += earnedPoints - usedFromThisEarn;
    }
  }

  return Math.max(0, availablePoints);
}

/**
 * Oblicza ile punktów można użyć z konta (z uwzględnieniem dat ważności).
 * Alias dla getAvailablePoints dla czytelności kodu.
 */
export async function getUsablePoints(
  prisma: PrismaClient,
  accountId: string,
  asOfDate: Date = new Date()
): Promise<number> {
  return getAvailablePoints(prisma, accountId, asOfDate);
}

/**
 * Sprawdza czy użytkownik ma wystarczającą liczbę punktów.
 */
export async function hasEnoughPoints(
  prisma: PrismaClient,
  accountId: string,
  requiredPoints: number,
  asOfDate: Date = new Date()
): Promise<boolean> {
  const available = await getAvailablePoints(prisma, accountId, asOfDate);
  return available >= requiredPoints;
}

