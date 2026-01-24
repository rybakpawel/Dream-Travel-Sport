import {
  CheckoutSessionStatus,
  LoyaltyTxnType,
  OrderStatus,
  PaymentProvider,
  PaymentStatus,
  TripAvailability
} from "@prisma/client";

import { prisma } from "../prisma.js";

/**
 * Czyści wygasłe sesje checkoutu i tokeny magic link.
 * Funkcja powinna być wywoływana regularnie (np. co 5-10 minut).
 */
export async function cleanupExpiredSessionsAndTokens(): Promise<{
  expiredSessions: number;
  releasedPoints: number;
  expiredTokens: number;
  expiredP24Orders: number;
  releasedSeats: number;
}> {
  const now = new Date();
  let expiredSessionsCount = 0;
  let totalPointsReleased = 0;
  let expiredTokensCount = 0;
  let expiredP24OrdersCount = 0;
  let releasedSeatsCount = 0;

  try {
    // 1. Znajdź wszystkie wygasłe sesje checkoutu (status PENDING, expiresAt < now)
    const expiredSessions = await prisma.checkoutSession.findMany({
      where: {
        status: CheckoutSessionStatus.PENDING,
        expiresAt: { lt: now }
      },
      select: {
        id: true,
        pointsReserved: true,
        order: {
          select: {
            id: true,
            status: true,
            items: {
              select: {
                tripId: true,
                qty: true
              }
            },
            payments: {
              select: {
                id: true,
                provider: true,
                status: true
              }
            }
          }
        },
        magicLinkTokens: {
          where: {
            usedAt: null, // Tylko nieużyte tokeny
            expiresAt: { lt: now }
          },
          select: {
            id: true
          }
        }
      }
    });

    // 2. Przetwórz każdą wygasłą sesję w transakcjach (dla bezpieczeństwa)
    // UWAGA: Nie anulujemy tutaj zamówień P24 - te są anulowane przez sekcję 4 po ich własnym TTL (120 min lub 48h)
    // Nie anulujemy też zamówień z przelewem tradycyjnym - te czekają na ręczne zatwierdzenie przez admina
    for (const session of expiredSessions) {
      const pointsToRelease = session.pointsReserved ?? 0;

      await prisma.$transaction(async (tx) => {
        // Anuluj tylko zamówienia bez żadnej płatności (edge case - użytkownik złożył zamówienie, ale nie wybrał metody płatności)
        if (
          session.order &&
          session.order.status === OrderStatus.SUBMITTED &&
          session.order.payments.length === 0
        ) {
          // Pobierz pełne dane zamówienia (potrzebujemy orderNumber)
          const fullOrder = await tx.order.findUnique({
            where: { id: session.order.id },
            select: { orderNumber: true }
          });

          // Sprawdź czy zamówienie ma transakcję SPEND (punkty były odjęte przy składaniu)
          const spendTransaction = await tx.loyaltyTransaction.findFirst({
            where: {
              orderId: session.order.id,
              type: LoyaltyTxnType.SPEND
            },
            include: {
              account: {
                select: { id: true }
              }
            }
          });

          // Anuluj zamówienie bez płatności
          await tx.order.update({
            where: { id: session.order.id },
            data: { status: OrderStatus.CANCELLED }
          });

          // Zwolnij miejsca
          for (const item of session.order.items) {
            const trip = await tx.trip.findUnique({
              where: { id: item.tripId },
              select: {
                id: true,
                seatsLeft: true,
                capacity: true,
                availability: true
              }
            });

            if (!trip) continue;

            const unclamped = trip.seatsLeft + item.qty;
            const newSeatsLeft = Math.min(trip.capacity, unclamped);

            let nextAvailability = trip.availability;
            if (newSeatsLeft === 0) {
              nextAvailability = TripAvailability.CLOSED;
            } else if (trip.availability === TripAvailability.CLOSED) {
              // Jeśli wcześniej było CLOSED przez brak miejsc, otwieramy z powrotem
              nextAvailability = TripAvailability.OPEN;
            }

            await tx.trip.update({
              where: { id: trip.id },
              data: {
                seatsLeft: newSeatsLeft,
                availability: nextAvailability
              }
            });
          }

          // Zwróć punkty do konta (jeśli były odjęte przy składaniu zamówienia)
          if (spendTransaction && spendTransaction.account && fullOrder) {
            const pointsToReturn = Math.abs(spendTransaction.points);
            
            // Utwórz transakcję EARN z notatką o zwrocie
            await tx.loyaltyTransaction.create({
              data: {
                accountId: spendTransaction.account.id,
                type: LoyaltyTxnType.EARN,
                points: pointsToReturn,
                note: `Zwrot punktów za anulowane zamówienie ${fullOrder.orderNumber}`,
                orderId: session.order.id
              }
            });

            // Zaktualizuj saldo konta
            await tx.loyaltyAccount.update({
              where: { id: spendTransaction.account.id },
              data: { pointsBalance: { increment: pointsToReturn } }
            });
          }
        }
        // Zamówienia z płatnością P24 pozostają aktywne i są anulowane przez sekcję 4 po TTL (120 min lub 48h)
        // Zamówienia z przelewem tradycyjnym pozostają aktywne i czekają na ręczne zatwierdzenie przez admina

        // Oznacz sesję jako EXPIRED i zwolnij zarezerwowane punkty
        await tx.checkoutSession.update({
          where: { id: session.id },
          data: {
            status: CheckoutSessionStatus.EXPIRED,
            pointsReserved: 0
          }
        });

        // Oznacz powiązane wygasłe tokeny jako użyte (żeby nie można było ich użyć)
        if (session.magicLinkTokens.length > 0) {
          await tx.magicLinkToken.updateMany({
            where: {
              sessionId: session.id,
              usedAt: null,
              expiresAt: { lt: now }
            },
            data: {
              usedAt: now // Oznacz jako "użyte" (w rzeczywistości wygasłe)
            }
          });
        }
      });

      expiredSessionsCount++;
      totalPointsReleased += pointsToRelease;
      expiredTokensCount += session.magicLinkTokens.length;
    }

    // 3. Znajdź wygasłe tokeny, które nie są powiązane z wygasłymi sesjami
    // (na wypadek, gdyby sesja była już oznaczona jako EXPIRED, ale tokeny nie)
    const orphanedExpiredTokens = await prisma.magicLinkToken.findMany({
      where: {
        usedAt: null,
        expiresAt: { lt: now },
        session: {
          status: { not: CheckoutSessionStatus.PENDING } // Sesja już nie jest PENDING
        }
      },
      select: {
        id: true
      }
    });

    if (orphanedExpiredTokens.length > 0) {
      await prisma.$transaction(async (tx) => {
        await tx.magicLinkToken.updateMany({
          where: {
            id: { in: orphanedExpiredTokens.map((t) => t.id) }
          },
          data: {
            usedAt: now
          }
        });
      });

      expiredTokensCount += orphanedExpiredTokens.length;
    }

    // 4. Anuluj nieopłacone zamówienia P24 po TTL i zwolnij miejsca
    const p24TtlMinutes = Number(process.env.P24_RESERVATION_TTL_MINUTES ?? 120);
    const p24Cutoff = new Date(now.getTime() - p24TtlMinutes * 60 * 1000);

    // Pobierz kandydatów (SUBMITTED + mają jakąkolwiek próbę P24)
    const candidateOrders = await prisma.order.findMany({
      where: {
        status: OrderStatus.SUBMITTED,
        submittedAt: { lt: p24Cutoff },
        payments: {
          some: { provider: PaymentProvider.PRZELEWY24 }
        }
      },
      select: {
        id: true,
        orderNumber: true,
        submittedAt: true,
        checkoutSessionId: true,
        items: {
          select: {
            tripId: true,
            qty: true
          }
        },
        payments: {
          select: {
            id: true,
            provider: true,
            status: true,
            createdAt: true
          }
        }
      }
    });

    for (const order of candidateOrders) {
      // Jeśli jest jakikolwiek przelew tradycyjny, nie auto-anuluj (to rozstrzygamy ręcznie lub innym procesem)
      if (order.payments.some((p) => p.provider === PaymentProvider.MANUAL_TRANSFER)) {
        continue;
      }

      // Jeśli już opłacone, pomiń (edge case)
      if (order.payments.some((p) => p.provider === PaymentProvider.PRZELEWY24 && p.status === PaymentStatus.PAID)) {
        continue;
      }

      // TTL liczymy od ostatniej próby płatności P24 (wznowienie przedłuża rezerwację)
      const latestAttempt = order.payments
        .filter((p) => p.provider === PaymentProvider.PRZELEWY24)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

      if (latestAttempt && latestAttempt.createdAt >= p24Cutoff) {
        continue;
      }

      const seatsToRelease = order.items.reduce((sum, item) => sum + item.qty, 0);

      await prisma.$transaction(async (tx) => {
        const currentOrder = await tx.order.findUnique({
          where: { id: order.id },
          include: {
            items: true,
            payments: true,
            checkoutSession: true
          }
        });

        if (!currentOrder || currentOrder.status !== OrderStatus.SUBMITTED) {
          return;
        }

        // Jeśli w międzyczasie przyszła płatność, nie anuluj
        const hasPaid = currentOrder.payments.some(
          (p) => p.provider === PaymentProvider.PRZELEWY24 && p.status === PaymentStatus.PAID
        );
        if (hasPaid) {
          return;
        }

        // Sprawdź czy zamówienie ma transakcję SPEND (punkty były odjęte przy składaniu)
        const spendTransaction = await tx.loyaltyTransaction.findFirst({
          where: {
            orderId: currentOrder.id,
            type: LoyaltyTxnType.SPEND
          },
          include: {
            account: {
              select: { id: true }
            }
          }
        });

        // Anuluj zamówienie
        await tx.order.update({
          where: { id: currentOrder.id },
          data: { status: OrderStatus.CANCELLED }
        });

        // Anuluj aktywne próby płatności P24
        await tx.payment.updateMany({
          where: {
            orderId: currentOrder.id,
            provider: PaymentProvider.PRZELEWY24,
            status: PaymentStatus.PENDING
          },
          data: { status: PaymentStatus.CANCELLED }
        });

        // Zwróć punkty do konta (jeśli były odjęte przy składaniu zamówienia)
        if (spendTransaction && spendTransaction.account) {
          const pointsToReturn = Math.abs(spendTransaction.points);
          
          // Utwórz transakcję EARN z notatką o zwrocie
          await tx.loyaltyTransaction.create({
            data: {
              accountId: spendTransaction.account.id,
              type: LoyaltyTxnType.EARN,
              points: pointsToReturn,
              note: `Zwrot punktów za anulowane zamówienie ${currentOrder.orderNumber}`,
              orderId: currentOrder.id
            }
          });

          // Zaktualizuj saldo konta
          await tx.loyaltyAccount.update({
            where: { id: spendTransaction.account.id },
            data: { pointsBalance: { increment: pointsToReturn } }
          });
        }

        // Zwolnij miejsca
        for (const item of currentOrder.items) {
          const trip = await tx.trip.findUnique({
            where: { id: item.tripId },
            select: {
              id: true,
              seatsLeft: true,
              capacity: true,
              availability: true
            }
          });

          if (!trip) continue;

          const unclamped = trip.seatsLeft + item.qty;
          const newSeatsLeft = Math.min(trip.capacity, unclamped);

          let nextAvailability = trip.availability;
          if (newSeatsLeft === 0) {
            nextAvailability = TripAvailability.CLOSED;
          } else if (trip.availability === TripAvailability.CLOSED) {
            // Jeśli wcześniej było CLOSED przez brak miejsc, otwieramy z powrotem
            nextAvailability = TripAvailability.OPEN;
          }

          await tx.trip.update({
            where: { id: trip.id },
            data: {
              seatsLeft: newSeatsLeft,
              availability: nextAvailability
            }
          });
        }

        // Zwolnij zarezerwowane punkty (jeśli były ustawione) i oznacz sesję jako CANCELLED
        if (currentOrder.checkoutSession) {
          await tx.checkoutSession.update({
            where: { id: currentOrder.checkoutSession.id },
            data: {
              status: CheckoutSessionStatus.CANCELLED,
              pointsReserved: 0
            }
          });
        }
      });

      expiredP24OrdersCount++;
      releasedSeatsCount += seatsToRelease;
    }

    console.log(
      `[cleanup] Expired ${expiredSessionsCount} sessions, released ${totalPointsReleased} points, expired ${expiredTokensCount} tokens, cancelled ${expiredP24OrdersCount} P24 orders, released ${releasedSeatsCount} seats`
    );

    return {
      expiredSessions: expiredSessionsCount,
      releasedPoints: totalPointsReleased,
      expiredTokens: expiredTokensCount,
      expiredP24Orders: expiredP24OrdersCount,
      releasedSeats: releasedSeatsCount
    };
  } catch (err) {
    console.error("[cleanup] Error during cleanup:", err);
    throw err;
  }
}

/**
 * Czyści wygasłe sesje i tokeny przy sprawdzaniu sesji (backup cleanup).
 * Wywoływane synchronicznie przy każdym sprawdzeniu sesji.
 */
export async function cleanupExpiredSession(sessionId: string): Promise<boolean> {
  try {
    const session = await prisma.checkoutSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        status: true,
        expiresAt: true,
        pointsReserved: true,
        magicLinkTokens: {
          where: {
            usedAt: null,
            expiresAt: { lt: new Date() }
          },
          select: {
            id: true
          }
        }
      }
    });

    if (!session) {
      return false;
    }

    // Jeśli sesja jest PENDING i wygasła, oznacz jako EXPIRED
    if (session.status === CheckoutSessionStatus.PENDING && session.expiresAt < new Date()) {
      const pointsToRelease = session.pointsReserved ?? 0;

      await prisma.$transaction(async (tx) => {
        await tx.checkoutSession.update({
          where: { id: sessionId },
          data: {
            status: CheckoutSessionStatus.EXPIRED,
            pointsReserved: 0
          }
        });

        // Oznacz powiązane wygasłe tokeny
        if (session.magicLinkTokens.length > 0) {
          await tx.magicLinkToken.updateMany({
            where: {
              sessionId: session.id,
              usedAt: null,
              expiresAt: { lt: new Date() }
            },
            data: {
              usedAt: new Date()
            }
          });
        }
      });

      if (pointsToRelease > 0) {
        console.log(`[cleanup] Released ${pointsToRelease} points from expired session ${sessionId}`);
      }

      return true;
    }

    return false;
  } catch (err) {
    console.error(`[cleanup] Error cleaning up session ${sessionId}:`, err);
    return false;
  }
}

