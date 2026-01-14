import express from "express";
import { z } from "zod";

import { NotFoundError, ValidationError } from "../errors/app-error.js";
import type { Env } from "../env.js";
import { prisma } from "../prisma.js";
import { cleanupExpiredSession } from "../services/cleanup.js";

export function createCartRouter(env: Env): express.Router {
  const router = express.Router();

  const cartItemSchema = z.object({
    id: z.string().min(1, "ID wyjazdu jest wymagane"),
    qty: z.number().int().min(1).max(5, "Maksymalnie 5 osób na wyjazd"),
    departurePointId: z.string().optional(),
    priceCents: z.number().int().min(0).optional()
  });

  const cartSchema = z.array(cartItemSchema);

  // GET /api/cart/:sessionId - pobierz koszyk z sesji checkoutu
  router.get("/:sessionId", async (req, res, next) => {
    try {
      const { sessionId } = req.params;

      // Sprawdź i wyczyść wygasłą sesję (backup cleanup)
      await cleanupExpiredSession(sessionId);

      const session = await prisma.checkoutSession.findUnique({
        where: { id: sessionId },
        select: {
          id: true,
          status: true,
          cartData: true,
          expiresAt: true
        }
      });

      if (!session) {
        throw new NotFoundError("Checkout session");
      }

      // Sprawdź czy sesja nie wygasła
      if (session.expiresAt < new Date()) {
        return res.status(400).json({
          error: "Session expired",
          message: "Sesja checkoutu wygasła. Proszę rozpocząć nowy checkout."
        });
      }

      // Zwróć koszyk z sesji
      const cartData = session.cartData as Array<{ id: string; qty: number }> | null;
      const cart = Array.isArray(cartData) ? cartData : [];

      res.json({
        success: true,
        cart
      });
    } catch (err) {
      next(err);
    }
  });

  // PUT /api/cart/:sessionId - zaktualizuj koszyk w sesji checkoutu
  router.put("/:sessionId", async (req, res, next) => {
    try {
      const { sessionId } = req.params;
      const body = cartSchema.parse(req.body);

      // Sprawdź i wyczyść wygasłą sesję (backup cleanup)
      await cleanupExpiredSession(sessionId);

      const session = await prisma.checkoutSession.findUnique({
        where: { id: sessionId },
        select: {
          id: true,
          status: true,
          expiresAt: true
        }
      });

      if (!session) {
        throw new NotFoundError("Checkout session");
      }

      // Sprawdź czy sesja nie wygasła
      if (session.expiresAt < new Date()) {
        return res.status(400).json({
          error: "Session expired",
          message: "Sesja checkoutu wygasła. Proszę rozpocząć nowy checkout."
        });
      }

      // Sprawdź czy sesja jest w stanie PENDING
      if (session.status !== "PENDING") {
        return res.status(400).json({
          error: "Session is not pending",
          status: session.status,
          message:
            session.status === "PAID"
              ? "Ta sesja checkoutu została już zakończona (zamówienie utworzone). Nie można modyfikować koszyka."
              : "Sesja checkoutu nie jest w stanie umożliwiającym modyfikację koszyka."
        });
      }

      // Zaktualizuj koszyk w sesji
      await prisma.checkoutSession.update({
        where: { id: sessionId },
        data: {
          cartData: body
        }
      });

      res.json({
        success: true,
        cart: body,
        message: "Koszyk został zaktualizowany"
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

