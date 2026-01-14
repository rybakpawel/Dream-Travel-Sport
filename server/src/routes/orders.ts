import {
  CheckoutSessionStatus,
  DocumentType,
  InvoiceType,
  OrderStatus,
  TripAvailability,
  PaymentProvider,
  PaymentStatus
} from "@prisma/client";
import express from "express";
import { z } from "zod";

import {
  ConflictError,
  NotFoundError,
  UnprocessableEntityError,
  ValidationError
} from "../errors/app-error.js";
import type { Env } from "../env.js";
import { createOrdersRateLimiter } from "../middleware/rate-limit.js";
import { prisma } from "../prisma.js";
import type { EmailService } from "../services/email.js";

export function createOrdersRouter(env: Env, emailService: EmailService | null): express.Router {
  const router = express.Router();

  // Rate limiting dla zamówień
  router.use(createOrdersRateLimiter(env));

  const normalizeDocumentNumber = (value: string) =>
    value.replace(/\s+/g, "").replace(/-/g, "").toUpperCase();

  const passengerSchema = z
    .object({
      firstName: z.string().min(1, "Imię jest wymagane"),
      lastName: z.string().min(1, "Nazwisko jest wymagane"),
      birthDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Nieprawidłowy format daty (YYYY-MM-DD)")
        .min(1, "Data urodzenia jest wymagana"),
      documentType: z
        .enum([DocumentType.ID_CARD, DocumentType.PASSPORT] as const)
        .default(DocumentType.ID_CARD),
      // Normalizujemy aby format był spójny w DB (bez spacji/myślników, uppercase)
      documentNumber: z
        .string()
        .trim()
        .min(1, "Numer dokumentu jest wymagany")
        .transform((v) => normalizeDocumentNumber(v))
    })
    .superRefine((data, ctx) => {
      const doc = data.documentNumber;

      if (data.documentType === DocumentType.ID_CARD) {
        // PL dowód: 3 litery + 6 cyfr (np. ABC123456)
        if (!/^[A-Z]{3}\d{6}$/.test(doc)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["documentNumber"],
            message: "Numer dowodu powinien mieć format ABC123456"
          });
        }
        return;
      }

      if (data.documentType === DocumentType.PASSPORT) {
        // PL paszport: 2 litery + 7 cyfr (np. AA1234567)
        if (!/^[A-Z]{2}\d{7}$/.test(doc)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["documentNumber"],
            message: "Numer paszportu powinien mieć format AA1234567"
          });
        }
        return;
      }

      // Tylko ID_CARD i PASSPORT są wspierane w koszyku.
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["documentType"],
        message: "Nieobsługiwany typ dokumentu"
      });
    });

  const orderItemSchema = z.object({
    tripId: z.string().min(1, "Trip ID jest wymagane"),
    qty: z.number().int().min(1).max(5, "Maksymalnie 5 osób na wyjazd"),
    passengers: z.array(passengerSchema).min(1, "Dodaj co najmniej jednego uczestnika")
  });

  const createOrderSchema = z
    .object({
      // CheckoutSession ID (wymagane - sesja jest źródłem prawdy)
      checkoutSessionId: z.string().min(1, "Checkout session ID jest wymagane"),

      // Dane rezerwującego
      customerName: z.string().min(1, "Imię i nazwisko jest wymagane"),
      customerEmail: z.string().email("Nieprawidłowy adres e-mail"),
      customerPhone: z.string().min(1, "Numer telefonu jest wymagany"),

      // Faktura/paragon
      invoiceType: z.nativeEnum(InvoiceType).default(InvoiceType.RECEIPT),
      companyName: z.string().optional().nullable(),
      companyTaxId: z.string().optional().nullable(),
      companyAddress: z.string().optional().nullable(),

      // Pozycje zamówienia
      items: z.array(orderItemSchema).min(1, "Dodaj co najmniej jedną pozycję"),

      // Użycie punktów lojalnościowych (opcjonalne, domyślnie false)
      usePoints: z.boolean().default(false)
    })
    .superRefine((data, ctx) => {
      if (data.invoiceType !== InvoiceType.INVOICE_COMPANY) return;

      if (!data.companyName || data.companyName.trim().length < 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["companyName"],
          message: "Nazwa firmy jest wymagana"
        });
      }

      const nipRaw = data.companyTaxId ?? "";
      const nipDigits = nipRaw.replace(/\D/g, "");
      if (nipDigits.length !== 10) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["companyTaxId"],
          message: "NIP musi mieć 10 cyfr"
        });
      }

      if (!data.companyAddress || data.companyAddress.trim().length < 5) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["companyAddress"],
          message: "Adres firmy jest wymagany"
        });
      }
    });

  function generateOrderNumber(): string {
    const year = new Date().getFullYear();
    const random = Math.floor(Math.random() * 1000000)
      .toString()
      .padStart(6, "0");
    return `DTS-${year}-${random}`;
  }

  const lookupOrderSchema = z.object({
    orderNumber: z.string().min(1, "Numer zamówienia jest wymagany"),
    customerEmail: z.string().email("Nieprawidłowy adres e-mail")
  });

  /**
   * POST /api/orders/lookup - publiczny lookup statusu zamówienia (dla ekranu płatności)
   * Wymaga podania numeru zamówienia + emaila (minimalna ochrona przed wyciekiem danych).
   */
  router.post("/lookup", async (req, res, next) => {
    try {
      const body = lookupOrderSchema.parse(req.body);

      const order = await prisma.order.findUnique({
        where: { orderNumber: body.orderNumber },
        select: {
          id: true,
          orderNumber: true,
          status: true,
          totalCents: true,
          currency: true,
          customerEmail: true,
          submittedAt: true
        }
      });

      // Nie ujawniaj czy zamówienie istnieje, jeśli email się nie zgadza
      if (!order || order.customerEmail !== body.customerEmail) {
        throw new NotFoundError("Order");
      }

      // Preferuj płatność PAID (jeśli istnieje), w przeciwnym razie weź najnowszą
      const paidPayment = await prisma.payment.findFirst({
        where: { orderId: order.id, status: PaymentStatus.PAID },
        orderBy: { paidAt: "desc" }
      });
      const latestPayment =
        paidPayment ??
        (await prisma.payment.findFirst({
          where: { orderId: order.id },
          orderBy: { createdAt: "desc" }
        }));

      const payment = latestPayment
        ? {
            id: latestPayment.id,
            provider: latestPayment.provider,
            status: latestPayment.status,
            createdAt: latestPayment.createdAt,
            paidAt: latestPayment.paidAt
          }
        : null;

      // Instrukcje przelewu tradycyjnego (jeśli dotyczy)
      const manualTransfer =
        payment && payment.provider === PaymentProvider.MANUAL_TRANSFER
          ? {
              bankAccount: env.BANK_ACCOUNT || null,
              title: order.orderNumber,
              amountCents: order.totalCents,
              currency: order.currency
            }
          : null;

      return res.json({
        success: true,
        order: {
          id: order.id,
          orderNumber: order.orderNumber,
          status: order.status,
          totalCents: order.totalCents,
          currency: order.currency,
          submittedAt: order.submittedAt
        },
        payment,
        manualTransfer
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          error: "Validation error",
          details: err.errors.map((e) => ({
            path: e.path.join("."),
            message: e.message
          }))
        });
      }
      next(err);
    }
  });

  router.post("/", async (req, res, next) => {
    try {
      // Debug: loguj otrzymane dane (tymczasowo dla diagnozy)
      if (Array.isArray(req.body)) {
        console.error("[orders] ERROR: Received array instead of object:", req.body);
        return res.status(400).json({
          error: "Validation error",
          message: "Expected object, received array",
          details: [{ path: "root", message: "Request body must be an object, not an array" }]
        });
      }
      const body = createOrderSchema.parse(req.body);

      // Znajdź i zweryfikuj sesję checkoutu
      const session = await prisma.checkoutSession.findUnique({
        where: { id: body.checkoutSessionId },
        select: {
          id: true,
          status: true,
          customerEmail: true,
          userId: true,
          cartData: true,
          pointsReserved: true,
          expiresAt: true,
          user: {
            select: {
              id: true,
              email: true,
              loyaltyAccount: {
                select: {
                  id: true,
                  pointsBalance: true
                }
              }
            }
          }
        }
      });

      if (!session) {
        throw new NotFoundError("Checkout session");
      }

      if (session.status !== CheckoutSessionStatus.PENDING) {
        throw new ConflictError(`Session is not pending (status: ${session.status})`, {
          status: session.status
        });
      }

      if (session.expiresAt < new Date()) {
        await prisma.checkoutSession.update({
          where: { id: session.id },
          data: { status: CheckoutSessionStatus.EXPIRED }
        });
        throw new ValidationError("Session expired");
      }

      if (session.customerEmail !== body.customerEmail) {
        throw new ValidationError("Email mismatch with session");
      }

      // Walidacja: sprawdź czy wszystkie tripy istnieją i pobierz ich ceny
      const tripIds = body.items.map((item) => item.tripId);
      // Usuń duplikaty tripIds (ten sam wyjazd może być w koszyku kilka razy z różnymi miejscami wylotu)
      const uniqueTripIds = Array.from(new Set(tripIds));
      const tripsRaw = await (prisma.trip.findMany as any)({
        where: { id: { in: uniqueTripIds } },
        include: {
          departurePoints: {
            where: { isActive: true },
            select: { id: true, priceCents: true, city: true }
          }
        }
      });

      type TripWithDeparturePoints = {
        id: string;
        slug: string;
        name: string;
        priceCents: number | null;
        capacity: number | null;
        seatsLeft: number | null;
        availability: string;
        departurePoints: Array<{ id: string; priceCents: number; city: string }>;
      };

      const trips = tripsRaw as unknown as TripWithDeparturePoints[];

      if (trips.length !== uniqueTripIds.length) {
        throw new ValidationError("Jeden lub więcej wyjazdów nie istnieje", {
          path: "items",
          missingTrips: uniqueTripIds.filter((id) => !trips.some((t) => t.id === id))
        });
      }

      // Utwórz mapę trips z wszystkimi potrzebnymi danymi
      const tripMap = new Map(
        trips.map((t) => [
          t.id,
          {
            id: t.id,
            slug: t.slug,
            name: t.name,
            priceCents: t.priceCents,
            departurePoints: t.departurePoints,
            capacity: t.capacity,
            seatsLeft: t.seatsLeft,
            availability: t.availability
          }
        ])
      );

      // Mapuj cartData z sesji do items - znajdź departurePointId i priceCents dla każdego itemu
      const cartData = Array.isArray(session.cartData)
        ? (session.cartData as Array<{
            id: string;
            qty: number;
            departurePointId?: string;
            priceCents?: number;
          }>)
        : [];

      // Tworzymy mapę cartData po indeksie (pozycja w body.items odpowiada pozycji w cartData)
      // Używamy kombinacji tripId + departurePointId jako klucza, aby obsłużyć ten sam wyjazd z różnymi miejscami wylotu
      const cartDataMap = new Map<string, { departurePointId?: string; priceCents?: number }>();
      for (let i = 0; i < cartData.length; i++) {
        const cartItem = cartData[i];
        // Znajdź trip po slug (cartItem.id to slug)
        const matchingTrip = trips.find((t) => t.slug === cartItem.id);
        if (matchingTrip) {
          // Użyj kombinacji tripId + departurePointId jako klucza (lub tylko tripId jeśli brak departurePointId)
          const mapKey = cartItem.departurePointId
            ? `${matchingTrip.id}:${cartItem.departurePointId}`
            : matchingTrip.id;
          cartDataMap.set(mapKey, {
            departurePointId: cartItem.departurePointId,
            priceCents: cartItem.priceCents
          });
        }
      }

      // Walidacja: sprawdź czy liczba pasażerów zgadza się z qty
      for (const item of body.items) {
        if (item.passengers.length !== item.qty) {
          throw new ValidationError(
            `Liczba uczestników (${item.passengers.length}) nie zgadza się z ilością (${item.qty})`,
            {
              path: "items",
              tripId: item.tripId,
              passengersCount: item.passengers.length,
              qty: item.qty
            }
          );
        }
      }

      // Walidacja: sprawdź dostępność miejsc dla każdego wyjazdu
      // Pobierz aktualne dane o dostępności (przed transakcją, aby uniknąć race condition)
      type AvailabilityCheck = {
        tripId: string;
        available: boolean;
        tripName: string;
        seatsLeft: number | null;
        capacity: number | null;
        requestedQty: number;
        trip: {
          id: string;
          name: string;
          capacity: number;
          seatsLeft: number;
          availability: TripAvailability;
        } | null;
      };

      const availabilityChecks: AvailabilityCheck[] = await Promise.all(
        body.items.map(async (item) => {
          const trip = tripMap.get(item.tripId);
          if (!trip) {
            return {
              tripId: item.tripId,
              available: false,
              tripName: "Unknown",
              seatsLeft: null,
              capacity: null,
              requestedQty: item.qty,
              trip: null
            };
          }

          // Pobierz aktualne dane o wyjeździe (z bazy, nie z mapy)
          const currentTrip = await prisma.trip.findUnique({
            where: { id: item.tripId },
            select: { id: true, name: true, capacity: true, seatsLeft: true, availability: true }
          });

          if (!currentTrip) {
            return {
              tripId: item.tripId,
              available: false,
              tripName: trip.name,
              seatsLeft: null,
              capacity: null,
              requestedQty: item.qty,
              trip: null
            };
          }

          // Sprawdź dostępność
          const hasCapacity =
            currentTrip.capacity === null ||
            currentTrip.seatsLeft === null ||
            currentTrip.seatsLeft >= item.qty;
          const isOpen = currentTrip.availability === "OPEN";

          return {
            tripId: item.tripId,
            available: hasCapacity && isOpen,
            tripName: currentTrip.name,
            seatsLeft: currentTrip.seatsLeft,
            capacity: currentTrip.capacity,
            requestedQty: item.qty,
            trip: currentTrip
          };
        })
      );

      // Zaktualizuj tripMap z aktualnymi danymi (dla aktualizacji seatsLeft w transakcji)
      for (const check of availabilityChecks) {
        if (check.trip) {
          const fullTrip = tripMap.get(check.tripId);
          if (fullTrip) {
            tripMap.set(check.tripId, {
              ...fullTrip,
              seatsLeft: check.trip.seatsLeft,
              availability: check.trip.availability
            });
          }
        }
      }

      // Sprawdź czy wszystkie wyjazdy mają dostępne miejsca
      const unavailableTrips = availabilityChecks.filter((check) => !check.available);
      if (unavailableTrips.length > 0) {
        const details = unavailableTrips.map((check) => {
          if (check.seatsLeft === null || check.capacity === null) {
            return {
              path: "items",
              message: `Wyjazd "${check.tripName}" nie ma dostępnych miejsc`
            };
          }
          return {
            path: "items",
            message: `Wyjazd "${check.tripName}" ma tylko ${check.seatsLeft} dostępnych miejsc, a próbujesz zarezerwować ${check.requestedQty}`
          };
        });

        return res.status(400).json({
          error: "Validation error",
          details
        });
      }

      // Oblicz totalCents (przed zniżką z punktów), używając ceny z koszyka (jeśli dostępna)
      let totalCents = 0;
      for (let itemIndex = 0; itemIndex < body.items.length; itemIndex++) {
        const item = body.items[itemIndex];
        const trip = tripMap.get(item.tripId);
        if (!trip) continue;

        // Pobierz dane z koszyka dla tego wyjazdu - dopasuj po indeksie (pozycja w body.items odpowiada pozycji w cartData)
        let cartItemData: { departurePointId?: string; priceCents?: number } | undefined;

        // Spróbuj znaleźć po indeksie (pozycja w body.items odpowiada pozycji w cartData)
        if (itemIndex < cartData.length) {
          const cartItem = cartData[itemIndex];
          const matchingTrip = trips.find((t) => t.slug === cartItem.id);
          if (matchingTrip && matchingTrip.id === item.tripId) {
            cartItemData = {
              departurePointId: cartItem.departurePointId,
              priceCents: cartItem.priceCents
            };
          }
        }

        // Fallback: spróbuj znaleźć po tripId (dla kompatybilności wstecznej)
        if (!cartItemData) {
          cartItemData = cartDataMap.get(item.tripId);
        }

        // Użyj zapisanej ceny z koszyka (jeśli dostępna), w przeciwnym razie użyj ceny z API
        let itemPriceCents: number;
        if (
          cartItemData?.priceCents !== undefined &&
          cartItemData.priceCents !== null &&
          cartItemData.priceCents > 0
        ) {
          itemPriceCents = cartItemData.priceCents;
        } else if (trip.departurePoints && trip.departurePoints.length > 0) {
          // Fallback: użyj najtańszej ceny z miejsc wylotu
          itemPriceCents = Math.min(
            ...trip.departurePoints.map(
              (dp: { id: string; priceCents: number; city: string }) => dp.priceCents
            )
          );
        } else {
          // Fallback: użyj starej ceny z Trip (jeśli dostępna)
          itemPriceCents = trip.priceCents ?? 0;
        }

        totalCents += itemPriceCents * item.qty;
      }

      // Zastosuj zniżkę z punktów (tylko jeśli użytkownik wyraźnie wybrał użycie punktów)
      const requestedPoints = body.usePoints && session.pointsReserved ? session.pointsReserved : 0;
      const maxPointsAllowed = Math.floor(totalCents / 500); // 20% wartości koszyka (1 pkt = 1 zł)
      const pointsToUse = Math.min(requestedPoints, maxPointsAllowed);
      const discountCents = Math.min(pointsToUse * 100, totalCents); // 1 punkt = 1 zł = 100 groszy
      const finalTotalCents = totalCents - discountCents;

      // Utwórz zamówienie w transakcji
      const order = await prisma.$transaction(async (tx) => {
        // Znajdź lub utwórz User (potrzebujemy tylko userId do przypięcia do zamówienia)
        let userId = session.userId;

        if (!userId) {
          const existingUser = await tx.user.findUnique({
            where: { email: body.customerEmail },
            select: { id: true }
          });

          if (existingUser) {
            userId = existingUser.id;
          } else {
            const createdUser = await tx.user.create({
              data: { email: body.customerEmail },
              select: { id: true }
            });
            userId = createdUser.id;

            // Utwórz LoyaltyAccount dla nowego użytkownika
            await tx.loyaltyAccount.create({
              data: {
                userId,
                pointsBalance: 0
              }
            });
          }
        }

        const orderNumber = generateOrderNumber();

        const order = await tx.order.create({
          data: {
            orderNumber,
            status: OrderStatus.SUBMITTED,
            customerName: body.customerName,
            customerEmail: body.customerEmail,
            customerPhone: body.customerPhone,
            invoiceType: body.invoiceType,
            companyName: body.companyName ?? null,
            companyTaxId: body.companyTaxId ?? null,
            companyAddress: body.companyAddress ?? null,
            currency: "PLN",
            totalCents: finalTotalCents, // po zniżce z punktów
            userId,
            checkoutSessionId: session.id
          }
        });

        // Utwórz OrderItem + Passenger dla każdej pozycji
        for (let itemIndex = 0; itemIndex < body.items.length; itemIndex++) {
          const item = body.items[itemIndex];
          const trip = tripMap.get(item.tripId);
          if (!trip) continue;

          // Pobierz dane z koszyka dla tego wyjazdu - dopasuj po indeksie (pozycja w body.items odpowiada pozycji w cartData)
          let cartItemData: { departurePointId?: string; priceCents?: number } | undefined;

          // Spróbuj znaleźć po indeksie (pozycja w body.items odpowiada pozycji w cartData)
          if (itemIndex < cartData.length) {
            const cartItem = cartData[itemIndex];
            const matchingTrip = trips.find((t) => t.slug === cartItem.id);
            if (matchingTrip && matchingTrip.id === item.tripId) {
              cartItemData = {
                departurePointId: cartItem.departurePointId,
                priceCents: cartItem.priceCents
              };
            }
          }

          // Fallback: spróbuj znaleźć po tripId (dla kompatybilności wstecznej)
          if (!cartItemData) {
            cartItemData = cartDataMap.get(item.tripId);
          }

          // Użyj zapisanej ceny z koszyka (jeśli dostępna), w przeciwnym razie użyj ceny z API
          let itemPriceCents: number;
          let departurePointId: string | null = null;

          if (
            cartItemData?.priceCents !== undefined &&
            cartItemData.priceCents !== null &&
            cartItemData.priceCents > 0
          ) {
            itemPriceCents = cartItemData.priceCents;
            // Ustaw departurePointId jeśli jest dostępne
            if (cartItemData.departurePointId) {
              // Sprawdź czy departurePoint istnieje i należy do tego wyjazdu
              const departurePoint = trip.departurePoints.find(
                (dp: { id: string; priceCents: number; city: string }) =>
                  dp.id === cartItemData.departurePointId
              );
              if (departurePoint) {
                departurePointId = departurePoint.id;
              }
            }
          } else if (trip.departurePoints.length > 0) {
            // Fallback: użyj najtańszej ceny z miejsc wylotu
            const minPriceDeparturePoint = trip.departurePoints.reduce(
              (
                min: { id: string; priceCents: number; city: string },
                dp: { id: string; priceCents: number; city: string }
              ) => (dp.priceCents < min.priceCents ? dp : min)
            );
            itemPriceCents = minPriceDeparturePoint.priceCents;
            departurePointId = minPriceDeparturePoint.id;
          } else {
            // Fallback: użyj starej ceny z Trip (jeśli dostępna)
            itemPriceCents = trip.priceCents ?? 0;
            departurePointId = null;
          }

          const orderItem = await tx.orderItem.create({
            data: {
              orderId: order.id,
              tripId: trip.id,
              departurePointId: departurePointId,
              qty: item.qty,
              unitPriceCents: itemPriceCents,
              currency: "PLN"
            }
          });

          // Utwórz pasażerów
          for (const passenger of item.passengers) {
            await tx.passenger.create({
              data: {
                orderItemId: orderItem.id,
                firstName: passenger.firstName,
                lastName: passenger.lastName,
                birthDate: passenger.birthDate
                  ? new Date(passenger.birthDate + "T00:00:00Z")
                  : null,
                documentType: passenger.documentType,
                documentNumber: passenger.documentNumber ?? null
              }
            });
          }

          // Aktualizuj seatsLeft dla wyjazdu (jeśli capacity jest ustawione)
          // Atomowa rezerwacja miejsc (chroni przed oversell przy równoległych zamówieniach)
          const seatUpdate = await tx.trip.updateMany({
            where: {
              id: trip.id,
              availability: TripAvailability.OPEN,
              seatsLeft: { gte: item.qty }
            },
            data: {
              seatsLeft: { decrement: item.qty }
            }
          });

          if (seatUpdate.count !== 1) {
            const currentTrip = await tx.trip.findUnique({
              where: { id: trip.id },
              select: { seatsLeft: true }
            });
            const seatsLeft = currentTrip?.seatsLeft ?? 0;
            throw new UnprocessableEntityError(
              `Wyjazd "${trip.name}" ma tylko ${seatsLeft} dostępnych miejsc, a próbujesz zarezerwować ${item.qty}`,
              { tripId: trip.id, requestedQty: item.qty, availableSeats: seatsLeft }
            );
          }

          // Jeśli po odjęciu miejsc seatsLeft spadło do 0, zamknij wyjazd
          await tx.trip.updateMany({
            where: { id: trip.id, seatsLeft: 0 },
            data: { availability: TripAvailability.CLOSED }
          });
        }

        // Oznacz sesję jako PAID (źródło prawdy - blokuje alternatywne ścieżki)
        await tx.checkoutSession.update({
          where: { id: session.id },
          // pointsReserved ustawiamy na faktycznie użyte punkty (po clampie), żeby późniejsze przetwarzanie (webhook/admin)
          // nie odejmowało więcej punktów niż zostało zastosowane w cenie.
          data: { status: CheckoutSessionStatus.PAID, pointsReserved: pointsToUse }
        });

        return order;
      });

      // Pobierz szczegóły zamówienia z items dla emaila
      const orderWithItems = await prisma.order.findUnique({
        where: { id: order.id },
        select: {
          id: true,
          orderNumber: true,
          status: true,
          totalCents: true,
          currency: true,
          items: {
            select: {
              id: true,
              tripId: true,
              qty: true,
              unitPriceCents: true,
              trip: {
                select: {
                  id: true,
                  name: true,
                  slug: true
                }
              }
            }
          }
        }
      });

      // Wyślij email z potwierdzeniem zamówienia
      if (emailService && orderWithItems) {
        try {
          await emailService.sendOrderConfirmation({
            to: body.customerEmail,
            customerName: body.customerName,
            orderNumber: order.orderNumber,
            totalCents: order.totalCents,
            currency: order.currency,
            items: orderWithItems.items.map((item) => ({
              name: item.trip.name,
              qty: item.qty,
              priceCents: item.unitPriceCents
            }))
          });
        } catch (emailErr) {
          console.error("[orders] Failed to send order confirmation email:", emailErr);
          // Nie blokuj odpowiedzi - logujemy błąd
        }
      }

      res.status(201).json({
        success: true,
        message: "Rezerwacja została złożona.",
        order: {
          id: order.id,
          orderNumber: order.orderNumber,
          status: order.status,
          totalCents: order.totalCents,
          currency: order.currency
        }
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          error: "Validation error",
          details: err.errors.map((e) => ({
            path: e.path.join("."),
            message: e.message
          }))
        });
      }
      next(err);
    }
  });

  return router;
}
