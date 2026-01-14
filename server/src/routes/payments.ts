import { LoyaltyTxnType, OrderStatus, PaymentProvider, PaymentStatus } from "@prisma/client";
import { calculateExpirationDate } from "../services/loyalty.js";
import express from "express";
import { z } from "zod";
import crypto from "node:crypto";

import { ConflictError, NotFoundError, ValidationError } from "../errors/app-error.js";
import type { Env } from "../env.js";
import { createP24WebhookWhitelist } from "../middleware/rate-limit.js";
import { prisma } from "../prisma.js";
import { createP24Client, type P24TransactionRequest } from "../services/p24.js";
import type { EmailService } from "../services/email.js";

export function createPaymentsRouter(env: Env, emailService: EmailService | null) {
  const router = express.Router();
  const p24Client = createP24Client(env);
  const p24WebhookWhitelist = createP24WebhookWhitelist(env);

  const createPaymentSchema = z.object({
    provider: z.nativeEnum(PaymentProvider).default(PaymentProvider.PRZELEWY24),
    // Jeśli true: zawsze twórz nową próbę płatności (np. po błędzie / braku wpłaty)
    forceNew: z.boolean().optional().default(false)
  });

  // POST /api/orders/:orderId/payments - inicjalizacja płatności
  router.post("/orders/:orderId/payments", async (req, res, next) => {
    try {
      const { orderId } = req.params;
      const body = createPaymentSchema.parse(req.body);

      // Znajdź zamówienie
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          orderNumber: true,
          status: true,
          totalCents: true,
          currency: true,
          customerName: true,
          customerEmail: true,
          customerPhone: true,
          checkoutSessionId: true,
          items: {
            select: {
              id: true,
              tripId: true,
              qty: true,
              unitPriceCents: true
            }
          }
        }
      });

      if (!order) {
        throw new NotFoundError("Order");
      }

      if (order.status === OrderStatus.CANCELLED) {
        throw new ConflictError("Order is cancelled");
      }

      // Sprawdź czy już istnieje płatność dla tego zamówienia
      const existingPaidPayment = await prisma.payment.findFirst({
        where: {
          orderId: order.id,
          provider: body.provider,
          status: PaymentStatus.PAID
        },
        orderBy: { createdAt: "desc" }
      });

      if (existingPaidPayment) {
        return res.status(200).json({
          success: true,
          message: "Payment already paid",
          payment: {
            id: existingPaidPayment.id,
            status: existingPaidPayment.status,
            provider: existingPaidPayment.provider
          }
        });
      }

      const existingPendingPayment = await prisma.payment.findFirst({
        where: {
          orderId: order.id,
          provider: body.provider,
          status: PaymentStatus.PENDING
        },
        orderBy: { createdAt: "desc" }
      });

      if (existingPendingPayment && !body.forceNew) {
        // Idempotencja / resume flow:
        // - jeśli to ta sama metoda i jest PENDING -> zwróć redirectUrl (dla P24) lub message (manual transfer)
        if (existingPendingPayment.provider === PaymentProvider.PRZELEWY24 && p24Client) {
          return res.status(200).json({
            success: true,
            message: "Payment already initialized",
            payment: {
              id: existingPendingPayment.id,
              status: existingPendingPayment.status,
              provider: existingPendingPayment.provider
            },
            redirectUrl: existingPendingPayment.externalId
              ? p24Client.getPaymentUrl(existingPendingPayment.externalId)
              : undefined
          });
        }

        return res.status(200).json({
          success: true,
          message: "Payment already created",
          payment: {
            id: existingPendingPayment.id,
            status: existingPendingPayment.status,
            provider: existingPendingPayment.provider
          }
        });
      }

      // Jeśli forceNew, anuluj istniejące PENDING dla tej metody, żeby nie zostawiać "wiszących" prób
      if (existingPendingPayment && body.forceNew) {
        await prisma.payment.updateMany({
          where: {
            orderId: order.id,
            provider: body.provider,
            status: PaymentStatus.PENDING
          },
          data: { status: PaymentStatus.CANCELLED }
        });
      }

      // Utwórz płatność
      if (body.provider === PaymentProvider.PRZELEWY24) {
        if (!p24Client) {
          return res.status(503).json({
            error: "Przelewy24 is not configured. Use MANUAL_TRANSFER instead."
          });
        }

        const serverPublicUrl = (env.SERVER_PUBLIC_URL || `http://localhost:${env.PORT}`).replace(
          /\/$/,
          ""
        );
        const frontendUrl = env.CORS_ORIGIN.replace(/\/$/, "");

        // P24 często traktuje sessionId jako klucz idempotencji.
        // Jeśli użyjemy stale orderNumber, ponowne próby płatności mogą zwracać ten sam token,
        // który po błędzie jest już "zakończony" i powoduje natychmiastowy redirect z P24.
        // Dlatego generujemy unikalne sessionId per próba, ale zawierające bazowy orderNumber.
        const p24SessionId = `${order.orderNumber}-${crypto.randomBytes(4).toString("hex")}`;

        // Inicjalizuj transakcję w P24
        const p24Req: P24TransactionRequest = {
          sessionId: p24SessionId,
          amount: order.totalCents,
          currency: "PLN",
          description: `Zamówienie ${order.orderNumber} - Dream Travel Sport`,
          email: order.customerEmail,
          client: order.customerName || order.customerEmail,
          phone: order.customerPhone || undefined,
          country: "PL",
          language: "pl",
          // Powrót po płatności (nie jest to twarde potwierdzenie - status potwierdza webhook)
          urlReturn: `${frontendUrl}/platnosc.html?order=${encodeURIComponent(order.orderNumber)}`,
          urlStatus: `${serverPublicUrl}/api/payments/webhook`,
          // P24 zwraca "Incorrect time limit" dla zbyt dużych wartości (np. 900).
          // W praktyce przyjmowane jest 1..99 (min) — ustawiamy 15.
          timeLimit: 15 // 15 minut
        };

        const p24Response = await p24Client.createTransaction(p24Req);

        // Zapisz płatność w bazie
        const payment = await prisma.payment.create({
          data: {
            orderId: order.id,
            provider: PaymentProvider.PRZELEWY24,
            status: PaymentStatus.PENDING,
            amountCents: order.totalCents,
            currency: order.currency,
            externalId: p24Response.data.token,
            raw: {
              ...((p24Response as unknown as Record<string, unknown>) || {}),
              _meta: {
                p24SessionId,
                orderNumber: order.orderNumber
              }
            } as any
          }
        });

        return res.status(201).json({
          success: true,
          payment: {
            id: payment.id,
            status: payment.status,
            provider: payment.provider
          },
          redirectUrl: p24Client.getPaymentUrl(p24Response.data.token)
        });
      } else if (body.provider === PaymentProvider.MANUAL_TRANSFER) {
        // Przelew tradycyjny - tylko zapisujemy płatność jako PENDING
        const payment = await prisma.payment.create({
          data: {
            orderId: order.id,
            provider: PaymentProvider.MANUAL_TRANSFER,
            status: PaymentStatus.PENDING,
            amountCents: order.totalCents,
            currency: order.currency
          }
        });

        // Wyślij instrukcje płatności emailem
        if (emailService) {
          try {
            // TODO: Pobierz numer konta bankowego z konfiguracji/env
            const bankAccount =
              env.BANK_ACCOUNT || "Szczegóły płatności zostaną przesłane w osobnej wiadomości.";
            await emailService.sendPaymentInstructions({
              to: order.customerEmail,
              customerName: order.customerName || order.customerEmail,
              orderNumber: order.orderNumber,
              totalCents: order.totalCents,
              currency: order.currency,
              bankAccount
            });
          } catch (emailErr) {
            console.error("[payments] Failed to send payment instructions email:", emailErr);
            // Nie blokuj odpowiedzi
          }
        }

        return res.status(201).json({
          success: true,
          message: "Payment created. You will receive transfer instructions via email.",
          payment: {
            id: payment.id,
            status: payment.status,
            provider: payment.provider
          }
        });
      }

      return res.status(400).json({ error: "Invalid payment provider" });
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

  // POST /api/payments/webhook - webhook od P24
  // Uwaga: router jest montowany pod "/api" (server/src/app.ts), więc ścieżka musi zawierać "/payments".
  // Dodatkowo: webhook może przyjść jako JSON albo x-www-form-urlencoded — obsługujemy oba.
  const handleP24Webhook: express.RequestHandler = async (req, res, next) => {
    try {
      if (!p24Client) {
        return res.status(503).json({ error: "P24 not configured" });
      }

      // Body może być już sparsowane przez express.json (globalnie w app.ts),
      // albo może być obiektem z express.urlencoded, albo (rzadko) Buffer/string.
      let body: Record<string, unknown> = {};
      try {
        if (Buffer.isBuffer(req.body)) {
          body = JSON.parse(req.body.toString("utf8")) as Record<string, unknown>;
        } else if (typeof req.body === "string") {
          body = JSON.parse(req.body) as Record<string, unknown>;
        } else if (req.body && typeof req.body === "object" && !Array.isArray(req.body)) {
          body = req.body as Record<string, unknown>;
        } else {
          body = {};
        }
      } catch (parseErr) {
        console.error("[webhook] Failed to parse webhook body:", parseErr);
        return res.status(400).json({ error: "Invalid webhook body" });
      }

      // Normalizuj nazwy pól (P24 bywa wysyłane z prefixem p24_...)
      const merchantId =
        body.merchantId ?? body.p24_merchant_id ?? body.p24MerchantId ?? body.merchant_id;
      const posId = body.posId ?? body.p24_pos_id ?? body.p24PosId ?? body.pos_id;
      const sessionId =
        body.sessionId ?? body.p24_session_id ?? body.p24SessionId ?? body.session_id;
      const amount = body.amount ?? body.p24_amount ?? body.p24Amount;
      const currency = body.currency ?? body.p24_currency ?? body.p24Currency;
      const orderId = body.orderId ?? body.p24_order_id ?? body.p24OrderId ?? body.order_id;
      const sign = body.sign ?? body.p24_sign ?? body.p24Sign;

      // Wyciągnij bazowy numer zamówienia z sessionId (format: DTS-YYYY-XXXXXX-<suffix>)
      const sessionIdStr = sessionId ? String(sessionId) : "";
      const orderNumberFromSession = (() => {
        const parts = sessionIdStr.split("-");
        if (
          parts.length >= 3 &&
          parts[0] === "DTS" &&
          /^\d{4}$/.test(parts[1]) &&
          /^\d{6}$/.test(parts[2])
        ) {
          return parts.slice(0, 3).join("-");
        }
        return sessionIdStr;
      })();

      console.log("[webhook] P24 webhook received:", {
        ip: req.ip,
        contentType: req.headers["content-type"],
        sessionId: sessionId ? String(sessionId) : null,
        orderNumber: orderNumberFromSession || null,
        orderId: orderId ? String(orderId) : null,
        amount: amount ? String(amount) : null,
        currency: currency ? String(currency) : null
      });

      // Walidacja wymaganych pól
      if (!merchantId || !posId || !sessionId || !amount || !currency || !orderId || !sign) {
        console.error("[webhook] Missing required fields:", {
          merchantId,
          posId,
          sessionId,
          amount,
          currency,
          orderId,
          sign: !!sign
        });
        return res.status(400).json({ error: "Missing required fields" });
      }

      // Weryfikuj sygnaturę webhooka
      const isValidSignature = p24Client.verifyWebhookSignature({
        merchantId: String(merchantId),
        posId: String(posId),
        sessionId: String(sessionId),
        amount: String(amount),
        currency: String(currency),
        orderId: String(orderId),
        sign: String(sign)
      });

      if (!isValidSignature) {
        // Niektóre środowiska P24 potrafią wysyłać webhook z innym formatem sign.
        // Dla bezpieczeństwa i tak robimy transaction/verify (to jest twarde potwierdzenie),
        // więc nie blokujemy flow wyłącznie na podstawie sign — logujemy ostrzeżenie.
        console.warn("[webhook] Invalid webhook signature (will rely on transaction/verify)", {
          sessionId: String(sessionId),
          orderId: String(orderId)
        });
      }

      // Znajdź zamówienie po orderNumber (sessionId) - PRZED weryfikacją API (szybsze)
      const order = await prisma.order.findUnique({
        where: { orderNumber: orderNumberFromSession },
        select: {
          id: true,
          orderNumber: true,
          status: true,
          totalCents: true,
          currency: true,
          customerName: true,
          customerEmail: true,
          checkoutSessionId: true,
          payments: {
            select: {
              id: true,
              provider: true,
              status: true,
              amountCents: true,
              externalId: true
            }
          },
          checkoutSession: {
            select: {
              id: true,
              status: true,
              customerEmail: true,
              userId: true,
              pointsReserved: true,
              user: {
                select: {
                  id: true,
                  loyaltyAccount: {
                    select: {
                      id: true,
                      pointsBalance: true
                    }
                  }
                }
              }
            }
          },
          userId: true,
          user: {
            select: {
              id: true,
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

      if (!order) {
        throw new NotFoundError("Order", { sessionId });
      }

      // Idempotencja: sprawdź czy webhook już został przetworzony
      const alreadyPaid = order.payments.some(
        (p) => p.provider === PaymentProvider.PRZELEWY24 && p.status === PaymentStatus.PAID
      );
      if (alreadyPaid) {
        // Nie wychodź od razu — dopinamy idempotentnie status zamówienia i punkty lojalnościowe,
        // gdyby poprzednie przetworzenie przerwało się po drodze.
        console.log(
          `[webhook] Webhook received for already-paid order ${order.orderNumber} (will ensure state)`
        );
      }

      // Weryfikuj transakcję przez API P24 (dodatkowa warstwa bezpieczeństwa)
      const verifyResponse = await p24Client.verifyTransaction({
        merchantId: parseInt(String(merchantId), 10),
        posId: parseInt(String(posId), 10),
        sessionId: String(sessionId),
        amount: parseInt(String(amount), 10),
        currency: currency as "PLN",
        orderId: parseInt(String(orderId), 10)
      });

      // Kwota z webhooka (w groszach) - używana zarówno do verify jak i do walidacji
      const webhookAmount = parseInt(String(amount), 10);

      if (verifyResponse.data.status !== "success") {
        if (!isValidSignature) {
          throw new ValidationError("Invalid webhook signature", { sessionId, orderId });
        }

        // Scenariusze typu: błąd płatności / brak wpłaty / zapłać ponownie.
        // Nie potwierdzamy zamówienia, ale ACK'ujemy webhook (żeby w P24 nie wisiało "Do wykorzystania")
        // i zapisujemy status jako FAILED po naszej stronie.
        console.warn("[webhook] P24 verification returned error - marking payment as FAILED", {
          sessionId: String(sessionId),
          orderId: String(orderId),
          message: verifyResponse.data.message
        });

        await prisma.$transaction(async (tx) => {
          const currentOrder = await tx.order.findUnique({
            where: { id: order.id },
            include: { payments: true }
          });

          if (!currentOrder) return;

          // Jeśli płatność została już potwierdzona - nic nie rób (idempotencja)
          const paidPayment = currentOrder.payments.find(
            (p) => p.provider === PaymentProvider.PRZELEWY24 && p.status === PaymentStatus.PAID
          );
          if (paidPayment) return;

          const pendingPayment = currentOrder.payments.find(
            (p) => p.provider === PaymentProvider.PRZELEWY24 && p.status === PaymentStatus.PENDING
          );

          const buildRaw = (existingRaw: unknown) => {
            const base =
              existingRaw && typeof existingRaw === "object" && !Array.isArray(existingRaw)
                ? (existingRaw as Record<string, unknown>)
                : { register: existingRaw };

            return {
              ...base,
              webhook: body,
              p24OrderId: String(orderId),
              verify: verifyResponse.data
            };
          };

          if (pendingPayment) {
            await tx.payment.update({
              where: { id: pendingPayment.id },
              data: {
                status: PaymentStatus.FAILED,
                raw: buildRaw(pendingPayment.raw) as any
              }
            });
            return;
          }

          // Jeśli z jakiegoś powodu nie mamy PENDING - utwórz wpis FAILED (żeby status był widoczny)
          await tx.payment.create({
            data: {
              orderId: order.id,
              provider: PaymentProvider.PRZELEWY24,
              status: PaymentStatus.FAILED,
              amountCents: order.totalCents,
              currency: order.currency,
              externalId: null,
              raw: buildRaw(null) as any
            }
          });
        });

        return res.status(200).json({ status: "ok" });
      }

      console.log("[webhook] P24 verify OK:", {
        sessionId: String(sessionId),
        orderId: String(orderId)
      });

      // Walidacja: sprawdź czy kwota się zgadza
      if (webhookAmount !== order.totalCents) {
        // Nie potwierdzamy zamówienia (kwota niezgodna), ale ACK'ujemy webhook, żeby nie wisiało w P24.
        console.error("[webhook] Webhook amount mismatch - marking payment as FAILED", {
          orderNumber: order.orderNumber,
          expected: order.totalCents,
          received: webhookAmount
        });

        await prisma.$transaction(async (tx) => {
          const currentOrder = await tx.order.findUnique({
            where: { id: order.id },
            include: { payments: true }
          });

          if (!currentOrder) return;

          const paidPayment = currentOrder.payments.find(
            (p) => p.provider === PaymentProvider.PRZELEWY24 && p.status === PaymentStatus.PAID
          );
          if (paidPayment) return;

          const pendingPayment = currentOrder.payments.find(
            (p) => p.provider === PaymentProvider.PRZELEWY24 && p.status === PaymentStatus.PENDING
          );

          const buildRaw = (existingRaw: unknown) => {
            const base =
              existingRaw && typeof existingRaw === "object" && !Array.isArray(existingRaw)
                ? (existingRaw as Record<string, unknown>)
                : { register: existingRaw };

            return {
              ...base,
              webhook: body,
              p24OrderId: String(orderId),
              verify: verifyResponse.data,
              amountMismatch: { expected: order.totalCents, received: webhookAmount }
            };
          };

          if (pendingPayment) {
            await tx.payment.update({
              where: { id: pendingPayment.id },
              data: {
                status: PaymentStatus.FAILED,
                raw: buildRaw(pendingPayment.raw) as any
              }
            });
            return;
          }

          await tx.payment.create({
            data: {
              orderId: order.id,
              provider: PaymentProvider.PRZELEWY24,
              status: PaymentStatus.FAILED,
              amountCents: order.totalCents,
              currency: order.currency,
              externalId: null,
              raw: buildRaw(null) as any
            }
          });
        });

        return res.status(200).json({ status: "ok" });
      }

      // Przetwórz webhook w JEDNEJ transakcji:
      // - idempotentnie ustaw PAID dla płatności
      // - ustaw CONFIRMED dla zamówienia
      // - idempotentnie przetwórz punkty lojalnościowe (żeby uniknąć podwójnego SPEND/EARN w race condition)
      const result = await prisma.$transaction(async (tx) => {
        const currentOrder = await tx.order.findUnique({
          where: { id: order.id },
          include: {
            payments: true,
            checkoutSession: true,
            user: { include: { loyaltyAccount: true } },
            loyaltyTransactions: { select: { id: true, type: true } }
          }
        });

        if (!currentOrder) {
          throw new Error("Order not found in transaction");
        }

        // Helper: zachowaj dane z rejestracji (token) + dołóż webhook i orderId z P24
        const buildRaw = (existingRaw: unknown) => {
          const base =
            existingRaw && typeof existingRaw === "object" && !Array.isArray(existingRaw)
              ? (existingRaw as Record<string, unknown>)
              : { register: existingRaw };

          return {
            ...base,
            webhook: body,
            p24OrderId: String(orderId)
          };
        };

        // 1) Płatność PAID (idempotentnie)
        const paidPayment = currentOrder.payments.find(
          (p) => p.provider === PaymentProvider.PRZELEWY24 && p.status === PaymentStatus.PAID
        );
        const pendingPayment = currentOrder.payments.find(
          (p) => p.provider === PaymentProvider.PRZELEWY24 && p.status === PaymentStatus.PENDING
        );

        const payment =
          paidPayment ??
          (pendingPayment
            ? await tx.payment.update({
                where: { id: pendingPayment.id },
                data: {
                  status: PaymentStatus.PAID,
                  paidAt: new Date(),
                  raw: buildRaw(pendingPayment.raw) as any
                }
              })
            : await tx.payment.create({
                data: {
                  orderId: currentOrder.id,
                  provider: PaymentProvider.PRZELEWY24,
                  status: PaymentStatus.PAID,
                  amountCents: webhookAmount,
                  currency: currency as "PLN",
                  externalId: null,
                  raw: buildRaw(null) as any,
                  paidAt: new Date()
                }
              }));

        // 2) CONFIRMED (ta operacja blokuje wiersz zamówienia i serializuje konkurencyjne webhooki)
        await tx.order.update({
          where: { id: currentOrder.id },
          data: { status: OrderStatus.CONFIRMED }
        });

        // 3) Punkty lojalnościowe (idempotentnie per orderId+type)
        let spentApplied = 0;
        let earnedApplied = 0;

        const account = currentOrder.user?.loyaltyAccount ?? null;
        if (account) {
          const pointsUsed = currentOrder.checkoutSession?.pointsReserved ?? 0;
          const pointsToEarn = Math.floor(currentOrder.totalCents / 1000); // 10% wartości (po zniżce), 1 pkt = 1 zł

          const alreadySpend = currentOrder.loyaltyTransactions.some(
            (t) => t.type === LoyaltyTxnType.SPEND
          );
          const alreadyEarn = currentOrder.loyaltyTransactions.some(
            (t) => t.type === LoyaltyTxnType.EARN
          );

          if (pointsUsed > 0 && !alreadySpend) {
            await tx.loyaltyTransaction.create({
              data: {
                accountId: account.id,
                type: LoyaltyTxnType.SPEND,
                points: -pointsUsed,
                note: `Użycie punktów w zamówieniu ${currentOrder.orderNumber}`,
                orderId: currentOrder.id
              }
            });
            await tx.loyaltyAccount.update({
              where: { id: account.id },
              data: { pointsBalance: { decrement: pointsUsed } }
            });
            spentApplied = pointsUsed;
          }

          if (pointsToEarn > 0 && !alreadyEarn) {
            const expiresAt = calculateExpirationDate(new Date());

            await tx.loyaltyTransaction.create({
              data: {
                accountId: account.id,
                type: LoyaltyTxnType.EARN,
                points: pointsToEarn,
                note: `Naliczono punkty za zamówienie ${currentOrder.orderNumber} (10% wartości)`,
                orderId: currentOrder.id,
                expiresAt
              }
            });
            // Aktualizacja pointsBalance - użyjemy getAvailablePoints() w przyszłości,
            // ale na razie zachowujemy denormalizację dla kompatybilności
            await tx.loyaltyAccount.update({
              where: { id: account.id },
              data: { pointsBalance: { increment: pointsToEarn } }
            });
            earnedApplied = pointsToEarn;
          }
        }

        return { payment, spentApplied, earnedApplied };
      });

      console.log("[webhook] Processed P24 payment:", {
        orderNumber: order.orderNumber,
        paymentId: result.payment.id,
        spentApplied: result.spentApplied,
        earnedApplied: result.earnedApplied
      });

      // Email: potwierdzenie płatności (tylko raz — jeśli wcześniej nie było PAID dla P24)
      // Uwaga: webhook może przyjść wielokrotnie, więc używamy alreadyPaid jako prostego guard'a.
      if (emailService && !alreadyPaid) {
        try {
          await emailService.sendPaymentConfirmation({
            to: order.customerEmail,
            customerName: order.customerName || order.customerEmail,
            orderNumber: order.orderNumber,
            totalCents: order.totalCents,
            currency: order.currency,
            pointsEarned: result.earnedApplied
          });
        } catch (emailErr) {
          console.error("[webhook] Failed to send payment confirmation email:", emailErr);
          // Nie blokuj ACK webhooka
        }
      }

      res.status(200).json({ status: "ok" });
    } catch (err) {
      next(err);
    }
  };

  // Whitelist IP dla bezpieczeństwa
  router.post(
    "/payments/webhook",
    p24WebhookWhitelist,
    express.urlencoded({ extended: false }),
    handleP24Webhook
  );

  // Backward-compat: stara ścieżka (jeśli gdzieś została skonfigurowana)
  router.post(
    "/webhook",
    p24WebhookWhitelist,
    express.urlencoded({ extended: false }),
    handleP24Webhook
  );

  return router;
}
