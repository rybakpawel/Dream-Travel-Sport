import { CheckoutSessionStatus } from "@prisma/client";
import express from "express";
import crypto from "node:crypto";
import { z } from "zod";

import type { Env } from "../env.js";
import { createMagicLinkRateLimiter } from "../middleware/rate-limit.js";
import { prisma } from "../prisma.js";
import { cleanupExpiredSession } from "../services/cleanup.js";
import type { EmailService } from "../services/email.js";
import { getAvailablePoints } from "../services/loyalty.js";

export function createCheckoutRouter(env: Env, emailService: EmailService | null): express.Router {
  const router = express.Router();

  const createSessionSchema = z.object({
    customerEmail: z.string().email("Nieprawidłowy adres e-mail"),
    cartData: z.array(
      z.object({
        id: z.string(),
        qty: z.number().int().min(1),
        departurePointId: z.string().optional(), // ID wybranego miejsca wylotu (opcjonalne)
        priceCents: z.number().int().min(0).optional() // Cena z wybranego miejsca wylotu (opcjonalne)
      })
    ) // snapshot koszyka z frontendu (tablica pozycji)
  });

  // POST /api/checkout/sessions - utworzenie sesji checkoutu
  router.post("/sessions", async (req, res, next) => {
    try {
      const body = createSessionSchema.parse(req.body);

      // SECURITY: Nie łącz sesji checkoutu z istniejącym User po samym emailu.
      // User zostanie powiązany dopiero po weryfikacji magic linkiem (lub przy finalizacji zamówienia).
      //
      // UX: Pokazujemy w koszyku informację o dostępnych punktach dla podanego emaila (bez przypinania userId do sesji).
      // To oznacza, że saldo punktów może być "podejrzane" znając cudzy email — jeśli chcesz tego uniknąć,
      // usuń preview i zostaw tylko flow z magic linkiem.

      // Utwórz sesję checkoutu (TTL: 30 minut)
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + 30);

      // Preview punktów (bez powiązania sesji z userem)
      const previewUser = await prisma.user.findUnique({
        where: { email: body.customerEmail },
        select: {
          loyaltyAccount: {
            select: {
              id: true
            }
          }
        }
      });
      const previewPoints = previewUser?.loyaltyAccount?.id
        ? await getAvailablePoints(prisma, previewUser.loyaltyAccount.id)
        : 0;

      const session = await prisma.checkoutSession.create({
        data: {
          customerEmail: body.customerEmail,
          cartData: body.cartData as any, // Prisma Json type
          userId: null,
          expiresAt
        },
        select: {
          id: true,
          status: true,
          customerEmail: true,
          expiresAt: true
        }
      });

      res.status(201).json({
        success: true,
        session: {
          id: session.id,
          status: session.status,
          customerEmail: session.customerEmail,
          expiresAt: session.expiresAt,
          loyaltyVerified: false,
          hasLoyaltyPoints: previewPoints > 0,
          loyaltyPoints: previewPoints
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

  // GET /api/checkout/sessions/:sessionId - status sesji
  router.get("/sessions/:sessionId", async (req, res, next) => {
    try {
      const { sessionId } = req.params;

      const session = await prisma.checkoutSession.findUnique({
        where: { id: sessionId },
        select: {
          id: true,
          status: true,
          customerEmail: true,
          expiresAt: true,
          pointsReserved: true,
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
          },
          order: {
            select: {
              id: true
            }
          }
        }
      });

      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }

      // Sprawdź i wyczyść wygasłą sesję (backup cleanup)
      const wasExpired = await cleanupExpiredSession(sessionId);
      if (wasExpired) {
        return res.status(400).json({ error: "Session expired" });
      }

      // Pobierz zaktualizowaną sesję (na wypadek, gdyby została oznaczona jako EXPIRED)
      const updatedSession = await prisma.checkoutSession.findUnique({
        where: { id: sessionId },
        select: {
          id: true,
          status: true,
          customerEmail: true,
          expiresAt: true,
          pointsReserved: true,
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
          },
          order: {
            select: {
              id: true
            }
          }
        }
      });

      if (!updatedSession) {
        return res.status(404).json({ error: "Session not found" });
      }

      if (updatedSession.status !== CheckoutSessionStatus.PENDING) {
        return res.status(400).json({
          error: "Session is not pending",
          status: updatedSession.status
        });
      }

      const loyaltyVerified = Boolean(updatedSession.userId);
      const pointsBalance =
        loyaltyVerified && updatedSession.user?.loyaltyAccount?.id
          ? await getAvailablePoints(prisma, updatedSession.user.loyaltyAccount.id)
          : (async () => {
              const user = await prisma.user.findUnique({
                where: { email: updatedSession.customerEmail },
                select: {
                  loyaltyAccount: {
                    select: {
                      id: true
                    }
                  }
                }
              });
              return user?.loyaltyAccount?.id
                ? await getAvailablePoints(prisma, user.loyaltyAccount.id)
                : 0;
            })();

      const resolvedPointsBalance = await pointsBalance;

      res.json({
        session: {
          id: updatedSession.id,
          status: updatedSession.status,
          customerEmail: updatedSession.customerEmail,
          expiresAt: updatedSession.expiresAt,
          pointsReserved: updatedSession.pointsReserved,
          loyaltyVerified,
          hasLoyaltyPoints: resolvedPointsBalance > 0,
          loyaltyPoints: resolvedPointsBalance,
          orderId: updatedSession.order?.id ?? null
        }
      });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/checkout/magic-link - generowanie magic linka
  // Rate limiting: 3 req/min na email
  router.post("/magic-link", createMagicLinkRateLimiter(env), async (req, res, next) => {
    try {
      const body = z
        .object({
          sessionId: z.string().min(1),
          customerEmail: z.string().email()
        })
        .parse(req.body);

      const session = await prisma.checkoutSession.findUnique({
        where: { id: body.sessionId },
        select: {
          id: true,
          status: true,
          customerEmail: true,
          userId: true,
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
        return res.status(404).json({ error: "Session not found" });
      }

      if (session.status !== CheckoutSessionStatus.PENDING) {
        return res.status(400).json({ error: "Session is not pending" });
      }

      if (session.expiresAt < new Date()) {
        return res.status(400).json({ error: "Session expired" });
      }

      if (session.customerEmail !== body.customerEmail) {
        return res.status(403).json({ error: "Email mismatch" });
      }

      // Sprawdź czy user istnieje i ma punkty
      let user = session.user;
      if (!user) {
        user = await prisma.user.findUnique({
          where: { email: body.customerEmail },
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
        });
      }

      // Privacy-preserving: nie ujawniamy czy email istnieje / czy są punkty.
      // Jeśli user nie istnieje albo nie ma punktów, zwracamy sukces bez generowania tokena.
      const genericOk = () =>
        res.json({
          success: true,
          message:
            "Jeśli na tym adresie są dostępne Dream Points, wysłaliśmy link do ich użycia. Sprawdź skrzynkę mailową."
        });

      if (!user || !user.loyaltyAccount?.id) {
        return genericOk();
      }

      const availablePoints = await getAvailablePoints(prisma, user.loyaltyAccount.id);
      if (availablePoints <= 0) {
        return genericOk();
      }

      const serverPublicUrl = (env.SERVER_PUBLIC_URL || `http://localhost:${env.PORT}`).replace(
        /\/$/,
        ""
      );
      const buildMagicLink = (t: string) => `${serverPublicUrl}/api/checkout/magic-link/${t}`;

      // Sprawdź czy już istnieje aktywny token dla tej sesji
      const existingToken = await prisma.magicLinkToken.findFirst({
        where: {
          sessionId: session.id,
          userId: user.id,
          usedAt: null,
          expiresAt: { gt: new Date() }
        }
      });

      if (existingToken) {
        // Nie generuj nowego.
        return res.json({
          success: true,
          message:
            "Jeśli na tym adresie są dostępne Dream Points, wysłaliśmy link do ich użycia. Sprawdź skrzynkę mailową.",
          token: env.NODE_ENV === "development" ? existingToken.token : undefined,
          magicLink:
            env.NODE_ENV === "development" ? buildMagicLink(existingToken.token) : undefined
        });
      }

      // Generuj jednorazowy token
      const token = crypto.randomBytes(32).toString("hex");
      const tokenExpiresAt = new Date();
      tokenExpiresAt.setMinutes(tokenExpiresAt.getMinutes() + 15); // 15 minut TTL

      await prisma.magicLinkToken.create({
        data: {
          token,
          sessionId: session.id,
          userId: user.id,
          expiresAt: tokenExpiresAt
        }
      });

      // Wyślij email z magic linkiem
      // Link prowadzi do backendu (/api/checkout/magic-link/:token), który weryfikuje token i robi redirect do koszyka.
      const magicLink = buildMagicLink(token);
      const pointsAvailable = user.loyaltyAccount?.id
        ? await getAvailablePoints(prisma, user.loyaltyAccount.id)
        : 0;

      if (emailService) {
        try {
          await emailService.sendMagicLink({
            to: body.customerEmail,
            customerName: undefined, // User model doesn't have name field
            magicLink,
            pointsAvailable,
            expiresInMinutes: 15
          });
        } catch (emailErr) {
          console.error("[checkout] Failed to send magic link email:", emailErr);
          // Nie blokuj odpowiedzi - logujemy błąd, ale zwracamy sukces
        }
      }

      res.json({
        success: true,
        message:
          "Jeśli na tym adresie są dostępne Dream Points, wysłaliśmy link do ich użycia. Sprawdź skrzynkę mailową.",
        // W development zwracamy też link w odpowiedzi (dla testów, gdy email jest wyłączony)
        token: env.NODE_ENV === "development" ? token : undefined,
        magicLink: env.NODE_ENV === "development" ? magicLink : undefined
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

  // GET /api/checkout/magic-link/:token - weryfikacja i użycie tokena
  router.get("/magic-link/:token", async (req, res, next) => {
    try {
      const { token } = req.params;

      const magicToken = await prisma.magicLinkToken.findUnique({
        where: { token },
        include: {
          session: {
            include: {
              user: {
                include: {
                  loyaltyAccount: true
                }
              }
            }
          },
          user: {
            include: {
              loyaltyAccount: true
            }
          }
        }
      });

      const frontendUrl = env.CORS_ORIGIN.replace(/\/$/, "");

      if (!magicToken) {
        // Redirect do strony koszyka z komunikatem błędu
        return res.redirect(
          `${frontendUrl}/koszyk.html?error=${encodeURIComponent("invalid_token")}&message=${encodeURIComponent("Nieprawidłowy link. Sprawdź czy link jest kompletny.")}`
        );
      }

      if (magicToken.usedAt) {
        // Redirect do strony koszyka z komunikatem błędu
        return res.redirect(
          `${frontendUrl}/koszyk.html?error=${encodeURIComponent("token_used")}&message=${encodeURIComponent("Ten link został już użyty. Jeśli chcesz użyć punktów, poproś o nowy link.")}`
        );
      }

      if (magicToken.expiresAt < new Date()) {
        // Redirect do strony koszyka z komunikatem błędu
        return res.redirect(
          `${frontendUrl}/koszyk.html?error=${encodeURIComponent("token_expired")}&message=${encodeURIComponent("Ten link wygasł. Linki do użycia punktów są ważne przez 15 minut. Poproś o nowy link.")}`
        );
      }

      const session = magicToken.session;

      // Sprawdź czy sesja nie wygasła
      if (session.expiresAt < new Date()) {
        return res.redirect(
          `${frontendUrl}/koszyk.html?error=${encodeURIComponent("session_expired")}&message=${encodeURIComponent("Sesja checkoutu wygasła. Proszę rozpocząć nowy checkout.")}`
        );
      }

      if (session.status !== CheckoutSessionStatus.PENDING) {
        const errorMessage =
            session.status === CheckoutSessionStatus.PAID
              ? "Ta sesja checkoutu została już opłacona. Nie można użyć punktów dla opłaconego zamówienia."
              : session.status === CheckoutSessionStatus.EXPIRED
                ? "Sesja checkoutu wygasła. Proszę rozpocząć nowy checkout."
              : "Sesja checkoutu nie jest w stanie umożliwiającym użycie punktów.";
        return res.redirect(
          `${frontendUrl}/koszyk.html?error=${encodeURIComponent("session_invalid")}&message=${encodeURIComponent(errorMessage)}`
        );
      }

      // Oznacz token jako użyty
      await prisma.magicLinkToken.update({
        where: { id: magicToken.id },
        data: { usedAt: new Date() }
      });

      // Zarezerwuj punkty (tymczasowo) - limit 20% wartości koszyka (1 pkt = 1 zł)
      const cart = Array.isArray(session.cartData)
        ? (session.cartData as Array<{
            id: string;
            qty: number;
            departurePointId?: string;
            priceCents?: number;
          }>)
        : [];

      // Oblicz całkowitą wartość koszyka, używając ceny z koszyka (jeśli dostępna) lub ceny z API
      let totalCents = 0;
      for (const item of cart) {
        // Użyj zapisanej ceny z koszyka (jeśli dostępna), w przeciwnym razie pobierz z API
        if (item.priceCents !== undefined && item.priceCents !== null && item.priceCents > 0) {
          totalCents += item.priceCents * item.qty;
        } else {
          // Fallback: pobierz cenę z API (najtańsza z miejsc wylotu)
          const cartIds = [item.id];
          // @ts-ignore - departurePoints relation exists in schema but Prisma Client needs regeneration
          const trips = (await prisma.trip.findMany({
            where: {
              OR: [{ id: { in: cartIds } }, { slug: { in: cartIds } }]
            },
            include: {
              departurePoints: {
                where: { isActive: true },
                select: { priceCents: true },
                orderBy: { priceCents: "asc" },
                take: 1
              }
            }
          })) as Array<{
            priceCents: number | null;
            departurePoints: Array<{ priceCents: number }>;
          }>;

          if (trips.length > 0) {
            const trip = trips[0];
            // Użyj najtańszej ceny z miejsc wylotu (jeśli dostępna) lub starej ceny
            const tripPriceCents =
              trip.departurePoints.length > 0
                ? trip.departurePoints[0].priceCents
                : (trip.priceCents ?? 0);
            totalCents += tripPriceCents * item.qty;
          }
        }
      }

      const maxPointsAllowed = Math.floor(totalCents / 500); // 20% * totalCents / 100
      const pointsBalance = magicToken.user.loyaltyAccount?.id
        ? await getAvailablePoints(prisma, magicToken.user.loyaltyAccount.id)
        : 0;
      const pointsToReserve = Math.min(pointsBalance, maxPointsAllowed);

      await prisma.checkoutSession.update({
        where: { id: session.id },
        data: {
          userId: magicToken.userId, // Upewnij się że sesja ma userId
          pointsReserved: pointsToReserve
        }
      });

      // Redirect do checkoutu z sesją
      res.redirect(
        `${frontendUrl}/koszyk.html?session=${encodeURIComponent(session.id)}&points=${encodeURIComponent(
          String(pointsToReserve)
        )}`
      );
    } catch (err) {
      next(err);
    }
  });

  // POST /api/checkout/sessions/:sessionId/apply-points - opcjonalne użycie punktów
  router.post("/sessions/:sessionId/apply-points", async (req, res, next) => {
    try {
      const { sessionId } = req.params;
      const body = z
        .object({
          pointsToUse: z.number().int().min(0).optional()
        })
        .parse(req.body);

      // Sprawdź i wyczyść wygasłą sesję (backup cleanup)
      await cleanupExpiredSession(sessionId);

      const session = await prisma.checkoutSession.findUnique({
        where: { id: sessionId },
        include: {
          user: {
            include: {
              loyaltyAccount: true
            }
          }
        }
      });

      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }

      // Sprawdź czy sesja nie wygasła
      if (session.expiresAt < new Date()) {
        return res.status(400).json({
          error: "Session expired",
          message: "Sesja checkoutu wygasła. Proszę rozpocząć nowy checkout."
        });
      }

      if (session.status !== CheckoutSessionStatus.PENDING) {
        return res.status(400).json({
          error: "Session is not pending",
          status: session.status,
          message:
            session.status === CheckoutSessionStatus.PAID
              ? "Ta sesja checkoutu została już opłacona."
              : session.status === CheckoutSessionStatus.EXPIRED
                ? "Sesja checkoutu wygasła."
                : "Sesja checkoutu nie jest w stanie umożliwiającym wykonanie tej akcji."
        });
      }

      // SECURITY: Punkty można używać dopiero po weryfikacji emaila magic linkiem,
      // bo inaczej wystarczy znać cudzy email, żeby podejrzeć/wykorzystać jego punkty.
      if (!session.userId) {
        return res.status(403).json({
          error: "Not verified",
          message: "Aby użyć Dream Points, musisz zweryfikować email linkiem wysłanym na skrzynkę."
        });
      }

      if (!session.user || !session.user.loyaltyAccount?.id) {
        return res.status(400).json({ error: "No loyalty account" });
      }

      const availablePoints = await getAvailablePoints(prisma, session.user.loyaltyAccount.id);
      const pointsToUse = body.pointsToUse ?? 0;

      if (pointsToUse > availablePoints) {
        return res.status(400).json({ error: "Not enough points" });
      }

      // Limit 20% wartości koszyka (1 pkt = 1 zł)
      const cart = Array.isArray(session.cartData)
        ? (session.cartData as Array<{
            id: string;
            qty: number;
            departurePointId?: string;
            priceCents?: number;
          }>)
        : [];

      // Oblicz całkowitą wartość koszyka, używając ceny z koszyka (jeśli dostępna) lub ceny z API
      let totalCents = 0;
      for (const item of cart) {
        // Użyj zapisanej ceny z koszyka (jeśli dostępna), w przeciwnym razie pobierz z API
        if (item.priceCents !== undefined && item.priceCents !== null && item.priceCents > 0) {
          totalCents += item.priceCents * item.qty;
        } else {
          // Fallback: pobierz cenę z API (najtańsza z miejsc wylotu)
          const cartIds = [item.id];
          // @ts-ignore - departurePoints relation exists in schema but Prisma Client needs regeneration
          const trips = (await prisma.trip.findMany({
            where: {
              OR: [{ id: { in: cartIds } }, { slug: { in: cartIds } }]
            },
            include: {
              departurePoints: {
                where: { isActive: true },
                select: { priceCents: true },
                orderBy: { priceCents: "asc" },
                take: 1
              }
            }
          })) as Array<{
            priceCents: number | null;
            departurePoints: Array<{ priceCents: number }>;
          }>;

          if (trips.length > 0) {
            const trip = trips[0];
            // Użyj najtańszej ceny z miejsc wylotu (jeśli dostępna) lub starej ceny
            const tripPriceCents =
              trip.departurePoints.length > 0
                ? trip.departurePoints[0].priceCents
                : (trip.priceCents ?? 0);
            totalCents += tripPriceCents * item.qty;
          }
        }
      }

      const maxPointsAllowed = Math.floor(totalCents / 500); // 20% * totalCents / 100
      if (pointsToUse > maxPointsAllowed) {
        return res.status(400).json({
          error: "Points limit exceeded",
          message: "Możesz użyć maksymalnie 20% wartości zamówienia w punktach.",
          maxPointsAllowed
        });
      }

      // Zaktualizuj zarezerwowane punkty
      await prisma.checkoutSession.update({
        where: { id: sessionId },
        data: { pointsReserved: pointsToUse }
      });

      res.json({
        success: true,
        pointsReserved: pointsToUse,
        availablePoints,
        maxPointsAllowed
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

  // POST /api/checkout/preview-agreement - generowanie podglądu umowy jako PDF
  router.post("/preview-agreement", async (req, res, next) => {
    try {
      const schema = z.object({
        customerName: z.string().min(1),
        customerEmail: z.string().email().optional(),
        customerPhone: z.string().optional(),
        invoiceType: z.enum(["RECEIPT", "INVOICE_PERSONAL", "INVOICE_COMPANY"]),
        companyName: z.string().nullable().optional(),
        companyTaxId: z.string().nullable().optional(),
        companyAddress: z.string().nullable().optional(),
        trips: z.array(
          z.object({
            tripId: z.string(),
            tripName: z.string(),
            tripDetails: z.string(),
            qty: z.number().int().min(1),
            departurePointId: z.string().optional(),
            priceCents: z.number().int().min(0),
            passengers: z
              .array(
                z.object({
                  firstName: z.string(),
                  lastName: z.string(),
                  birthDate: z.string(),
                  documentType: z.enum(["ID_CARD", "PASSPORT"]),
                  documentNumber: z.string()
                })
              )
              .optional()
          })
        ),
        pointsDiscountCents: z.number().int().min(0).optional() // Zniżka z Dream Points
      });

      const data = schema.parse(req.body);

      // Dynamiczny import pdfkit (jeśli jest zainstalowany)
      let PDFDocument: any;
      let fontPath: string | null = null;
      try {
        const pdfkit = await import("pdfkit");
        PDFDocument = (pdfkit as any).default || pdfkit;
        if (!PDFDocument) {
          throw new Error("PDFDocument not found");
        }

        // Spróbuj załadować font z pełnym wsparciem dla polskich znaków
        // Pdfkit ma wbudowane fonty, ale możemy użyć zewnętrznego fontu jeśli jest dostępny
        try {
          const fs = await import("node:fs");
          const path = await import("node:path");
          const { fileURLToPath } = await import("node:url");
          const { dirname } = await import("node:path");

          // Sprawdź czy istnieje font w katalogu assets/fonts
          const __filename = fileURLToPath(import.meta.url);
          const __dirname = dirname(__filename);
          const fontDir = path.join(__dirname, "../../../web/public/assets/fonts");

          // Szukaj fontu Arial lub podobnego obsługującego polskie znaki
          const possibleFonts = [
            "Arial.ttf",
            "arial.ttf",
            "Arial-Regular.ttf",
            "DejaVuSans.ttf",
            "LiberationSans-Regular.ttf"
          ];

          for (const fontFile of possibleFonts) {
            const fontFullPath = path.join(fontDir, fontFile);
            if (fs.existsSync(fontFullPath)) {
              fontPath = fontFullPath;
              break;
            }
          }
        } catch (fontErr) {
          // Jeśli nie można załadować zewnętrznego fontu, użyjemy wbudowanego
          console.warn("Could not load external font, using built-in:", fontErr);
        }
      } catch (err) {
        console.error("Failed to import pdfkit:", err);
        return res.status(500).json({
          error: "PDF generation library not installed",
          message: "Please install pdfkit: npm install pdfkit @types/pdfkit",
          details: err instanceof Error ? err.message : String(err)
        });
      }

      // Pobierz szczegóły wyjazdów z bazy danych
      const tripIds = data.trips.map((t) => t.tripId);
      const trips = await prisma.trip.findMany({
        where: { id: { in: tripIds } },
        include: {
          departurePoints: true
        }
      });

      const tripMap = new Map(trips.map((t) => [t.id, t]));

      // Utwórz dokument PDF
      const doc = new PDFDocument({
        margin: 50,
        size: "A4"
      });

      // Ustaw nagłówek odpowiedzi
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", 'inline; filename="podglad-umowy.pdf"');

      // Pipe PDF do odpowiedzi
      doc.pipe(res);

      // Zarejestruj i użyj fontu obsługującego polskie znaki
      let currentFont = "Helvetica"; // Fallback jeśli Arial nie jest dostępny
      if (fontPath) {
        try {
          const fs = await import("node:fs");
          doc.registerFont("Arial", fontPath);
          currentFont = "Arial";
          doc.font("Arial");
        } catch (fontErr) {
          console.warn("Failed to register Arial font, using Helvetica:", fontErr);
          // Helvetica jako fallback
          doc.font("Helvetica");
        }
      } else {
        // Spróbuj użyć Arial z systemu (jeśli dostępny)
        // Jeśli nie, użyj Helvetica jako fallback
        try {
          // Pdfkit nie ma wbudowanego Arial, więc użyjemy Helvetica
          // Arial można dodać jako zewnętrzny font w katalogu web/public/assets/fonts/
          doc.font("Helvetica");
          currentFont = "Helvetica";
        } catch (err) {
          console.warn("Could not set font, using default");
        }
      }

      // Nagłówek dokumentu
      doc.fontSize(20).text("PODGLĄD OFERTY", { align: "center" });
      doc.moveDown();

      // Data i godzina wygenerowania
      const now = new Date();
      const dateStr = now.toLocaleDateString("pl-PL");
      const timeStr = now.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
      doc.fontSize(12).text(`Oferta aktualna na: ${dateStr} - ${timeStr}`, {
        align: "center"
      });

      // Linki do ofert
      if (data.trips.length > 0) {
        doc.moveDown(0.5);
        const frontendUrl = env.CORS_ORIGIN.split(",")[0].trim().replace(/\/$/, "");
        const tripLinks: string[] = [];
        for (const tripData of data.trips) {
          const trip = tripMap.get(tripData.tripId);
          if (trip?.slug) {
            tripLinks.push(`${frontendUrl}/trip-details.html?slug=${trip.slug}`);
          }
        }
        if (tripLinks.length > 0) {
          doc.fontSize(10).text(`Wygenerowana z: ${tripLinks.join(", ")}`, {
            align: "center",
            color: "#666666"
          });
        }
      }

      doc.moveDown(2);

      // Dane klienta
      doc.fontSize(16).text("DANE KLIENTA", { underline: true });
      doc.moveDown();
      doc.fontSize(12);
      doc.text(`Imię i nazwisko: ${data.customerName}`);
      if (data.customerEmail) {
        doc.text(`E-mail: ${data.customerEmail}`);
      }
      if (data.customerPhone) {
        doc.text(`Telefon: ${data.customerPhone}`);
      }
      if (data.invoiceType === "INVOICE_COMPANY" && data.companyName) {
        doc.moveDown();
        doc.text(`Firma: ${data.companyName}`);
        if (data.companyTaxId) {
          doc.text(`NIP: ${data.companyTaxId}`);
        }
        if (data.companyAddress) {
          doc.text(`Adres: ${data.companyAddress}`);
        }
      }
      doc.moveDown(2);

      // Szczegóły wyjazdów
      doc.fontSize(16).text("SZCZEGÓŁY WYJAZDÓW", { underline: true });
      doc.moveDown();

      let totalCents = 0;
      for (const tripData of data.trips) {
        const trip = tripMap.get(tripData.tripId);
        const boldFont = currentFont === "Arial" ? "Arial" : "Helvetica-Bold";
        const normalFont = currentFont;
        doc.fontSize(14).font(boldFont).text(`Nazwa: ${tripData.tripName}`);
        doc.font(normalFont).fontSize(11);
        doc.text(`Liczba uczestników: ${tripData.qty}`);

        if (tripData.departurePointId && trip) {
          const departurePoint = trip.departurePoints.find(
            (dp) => dp.id === tripData.departurePointId
          );
          if (departurePoint) {
            doc.text(`Miejsce wylotu: ${departurePoint.city}`);
          }
        }

        if (trip?.hotelClass) {
          doc.text(`Klasa hotelu: ${"★".repeat(trip.hotelClass)}`);
        }

        const itemTotal = tripData.priceCents * tripData.qty;
        totalCents += itemTotal;
        doc.text(
          `Cena: ${(tripData.priceCents / 100).toFixed(2)} zł × ${tripData.qty} = ${(itemTotal / 100).toFixed(2)} zł`
        );

        // Dane uczestników
        if (tripData.passengers && tripData.passengers.length > 0) {
          doc.moveDown(0.5);
          doc.fontSize(12).font(boldFont).text("Uczestnicy:");
          doc.font(normalFont).fontSize(11);
          for (let i = 0; i < tripData.passengers.length; i++) {
            const passenger = tripData.passengers[i];
            const passengerNum = i + 1;
            doc.text(`${passengerNum}. ${passenger.firstName} ${passenger.lastName}`);
            if (passenger.birthDate) {
              const birthDate = new Date(passenger.birthDate);
              doc.text(`   Data urodzenia: ${birthDate.toLocaleDateString("pl-PL")}`);
            }
            const docTypeLabel =
              passenger.documentType === "ID_CARD" ? "Dowód osobisty" : "Paszport";
            doc.text(`   Dokument: ${docTypeLabel} - ${passenger.documentNumber}`);
            if (i < tripData.passengers.length - 1) {
              doc.moveDown(0.3);
            }
          }
        }

        doc.moveDown();
      }

      // Podsumowanie
      doc.moveDown();
      doc.fontSize(16).text("PODSUMOWANIE", { underline: true });
      doc.moveDown();
      doc.fontSize(14);
      doc.text(`Łączna liczba uczestników: ${data.trips.reduce((sum, t) => sum + t.qty, 0)}`);
      const summaryBoldFont = currentFont === "Arial" ? "Arial" : "Helvetica-Bold";
      
      // Uwzględnij zniżkę z Dream Points jeśli jest dostępna
      const pointsDiscountCents = data.pointsDiscountCents ?? 0;
      if (pointsDiscountCents > 0) {
        doc.text(`Kwota przed zniżką: ${(totalCents / 100).toFixed(2)} zł`);
        doc.text(`Zniżka z Dream Points: -${(pointsDiscountCents / 100).toFixed(2)} zł`);
        const finalTotalCents = Math.max(0, totalCents - pointsDiscountCents);
        doc.font(summaryBoldFont).text(`Łączna kwota: ${(finalTotalCents / 100).toFixed(2)} zł`);
      } else {
      doc.font(summaryBoldFont).text(`Łączna kwota: ${(totalCents / 100).toFixed(2)} zł`);
      }
      doc.font(currentFont);

      // Stopka
      doc.moveDown(3);
      doc
        .fontSize(10)
        .text("To jest podgląd oferty. Pełna umowa zostanie wygenerowana po złożeniu rezerwacji.", {
          align: "center",
          color: "#666666"
        });

      // Zakończ dokument
      doc.end();
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          error: "Validation error",
          message: "Invalid request data",
          details: err.errors
        });
      }
      next(err);
    }
  });

  return router;
}
