import express from "express";
import { z } from "zod";
import multer from "multer";
import jwt from "jsonwebtoken";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { closeSync, existsSync, mkdirSync, openSync, readSync, unlinkSync } from "node:fs";
import crypto from "node:crypto";
import {
  CheckoutSessionStatus,
  ContentPage,
  ContentSection,
  LoyaltyTxnType,
  OrderStatus,
  PaymentProvider,
  PaymentStatus,
  TripAvailability
} from "@prisma/client";

import { ConflictError, NotFoundError, ValidationError } from "../errors/app-error.js";
import type { Env } from "../env.js";
import { createAdminAuthMiddleware } from "../middleware/admin-auth.js";
import { prisma } from "../prisma.js";
import type { EmailService } from "../services/email.js";
import { calculateExpirationDate } from "../services/loyalty.js";

/**
 * Generuje slug z nazwy wyjazdu
 * Przykład: "Barcelona Weekend + El Clásico" -> "barcelona-weekend-el-clasico"
 */
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD") // Normalizuje znaki Unicode (np. á -> a + ́)
    .replace(/[\u0300-\u036f]/g, "") // Usuwa znaki diakrytyczne
    .replace(/[^a-z0-9\s-]/g, "") // Usuwa znaki specjalne (zostają tylko litery, cyfry, spacje, myślniki)
    .trim()
    .replace(/\s+/g, "-") // Zamienia spacje na myślniki
    .replace(/-+/g, "-") // Usuwa wielokrotne myślniki
    .replace(/^-|-$/g, ""); // Usuwa myślniki na początku i końcu
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Konfiguracja multer do uploadu obrazów
const tripsUploadDir = join(__dirname, "../../../web/public/assets/trips");
if (!existsSync(tripsUploadDir)) {
  mkdirSync(tripsUploadDir, { recursive: true });
}

const ALLOWED_IMAGE_MIME: Record<string, "jpeg" | "png" | "webp" | "gif"> = {
  "image/jpeg": "jpeg",
  "image/jpg": "jpeg", // Some browsers send image/jpg instead of image/jpeg
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif"
};

function imageKindToExt(kind: "jpeg" | "png" | "webp" | "gif"): string {
  switch (kind) {
    case "jpeg":
      return "jpg";
    case "png":
      return "png";
    case "webp":
      return "webp";
    case "gif":
      return "gif";
  }
}

function detectImageKindFromHeader(header: Buffer): "jpeg" | "png" | "webp" | "gif" | null {
  if (header.length < 2) return null;

  // JPEG: FF D8 (third byte can vary: FF, E0, E1, DB, etc.)
  // Standard JPEG signature starts with FF D8, which is sufficient to identify JPEG
  if (header[0] === 0xff && header[1] === 0xd8) {
    return "jpeg";
  }

  if (header.length < 12) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    header[0] === 0x89 &&
    header[1] === 0x50 &&
    header[2] === 0x4e &&
    header[3] === 0x47 &&
    header[4] === 0x0d &&
    header[5] === 0x0a &&
    header[6] === 0x1a &&
    header[7] === 0x0a
  ) {
    return "png";
  }

  // GIF: "GIF87a" / "GIF89a"
  if (
    header[0] === 0x47 &&
    header[1] === 0x49 &&
    header[2] === 0x46 &&
    header[3] === 0x38 &&
    (header[4] === 0x37 || header[4] === 0x39) &&
    header[5] === 0x61
  ) {
    return "gif";
  }

  // WEBP: "RIFF"...."WEBP"
  if (
    header[0] === 0x52 &&
    header[1] === 0x49 &&
    header[2] === 0x46 &&
    header[3] === 0x46 &&
    header[8] === 0x57 &&
    header[9] === 0x45 &&
    header[10] === 0x42 &&
    header[11] === 0x50
  ) {
    return "webp";
  }

  return null;
}

function verifyUploadedImage(filePath: string): "jpeg" | "png" | "webp" | "gif" | null {
  // Odczytaj tylko nagłówek (nie cały plik) i zwróć wykryty typ obrazu
  if (!existsSync(filePath)) {
    console.error(`[admin] File does not exist: ${filePath}`);
    return null;
  }

  const fd = openSync(filePath, "r");
  try {
    const header = Buffer.alloc(16);
    const bytesRead = readSync(fd, header, 0, header.length, 0);

    if (bytesRead < 2) {
      console.error(`[admin] File too small: only ${bytesRead} bytes read`);
      return null;
    }

    const slice = header.subarray(0, bytesRead);
    const detected = detectImageKindFromHeader(slice);

    const headerHex = Array.from(slice.slice(0, Math.min(8, bytesRead)))
      .map((b) => `0x${b.toString(16).padStart(2, "0")}`)
      .join(" ");
    console.log(
      `[admin] Image verification: file=${filePath}, detected=${detected}, bytesRead=${bytesRead}, header=${headerHex}`
    );

    if (detected === null) {
      console.error(`[admin] Could not detect image type from header. Header bytes: ${headerHex}`);
    }

    return detected;
  } catch (err) {
    console.error(`[admin] Error reading image header:`, err);
    return null;
  } finally {
    closeSync(fd);
  }
}

function isSafeUploadFilename(filename: string): boolean {
  if (!filename) return false;
  if (filename.length > 200) return false;
  // Blokuj path traversal / separatory (również windowsowe)
  if (filename.includes("/") || filename.includes("\\") || filename.includes("..")) return false;
  const lower = filename.toLowerCase();
  return (
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg") ||
    lower.endsWith(".png") ||
    lower.endsWith(".webp") ||
    lower.endsWith(".gif")
  );
}

function resolveUploadFilePath(filename: string): string {
  const base = resolve(tripsUploadDir);
  const full = resolve(tripsUploadDir, filename);
  const baseWithSep = base.endsWith("\\") || base.endsWith("/") ? base : base + "/";
  // resolve() na Windows zwróci backslash'e, ale porównanie prefiksu dalej zadziała po ujednoliceniu
  const baseNorm = baseWithSep.replace(/\\/g, "/");
  const fullNorm = full.replace(/\\/g, "/");
  if (!fullNorm.startsWith(baseNorm)) {
    throw new Error("Invalid file path");
  }
  return full;
}

// Funkcja pomocnicza do usuwania pliku obrazu
function deleteImageFile(imagePath: string | null | undefined): void {
  if (!imagePath) return;

  try {
    // Wyciągnij nazwę pliku ze ścieżki (np. /assets/trips/filename.jpg -> filename.jpg)
    const filename = imagePath.split("/").pop();
    if (!filename) return;

    if (!isSafeUploadFilename(filename)) return;
    const filePath = resolveUploadFilePath(filename);
    if (existsSync(filePath)) {
      unlinkSync(filePath);
      console.log(`[admin] Deleted image file: ${filePath}`);
    }
  } catch (err) {
    // Loguj błąd, ale nie przerywaj operacji
    console.error(`[admin] Failed to delete image file ${imagePath}:`, err);
  }
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, tripsUploadDir);
  },
  filename: (_req, file, cb) => {
    // Try to get kind from MIME type first
    let kind = ALLOWED_IMAGE_MIME[file.mimetype];

    // If MIME type is not recognized, try to detect from original filename extension
    if (!kind) {
      const originalExt = file.originalname.toLowerCase().split(".").pop();
      const extToKind: Record<string, "jpeg" | "png" | "webp" | "gif"> = {
        jpg: "jpeg",
        jpeg: "jpeg",
        png: "png",
        webp: "webp",
        gif: "gif"
      };
      kind = extToKind[originalExt || ""];
    }

    if (!kind) {
      console.error(
        `[admin] Unsupported file type: mimetype=${file.mimetype}, originalname=${file.originalname}`
      );
      return cb(new Error("Nieobsługiwany typ pliku. Dozwolone: JPG/PNG/WEBP/GIF."), "");
    }

    const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}`;
    const ext = imageKindToExt(kind);
    cb(null, `${uniqueSuffix}.${ext}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  },
  fileFilter: (_req, file, cb) => {
    // Dozwolone tylko bezpieczne formaty rastrowe (bez SVG)
    let kind = ALLOWED_IMAGE_MIME[file.mimetype];

    // If MIME type is not recognized, try to detect from original filename extension
    if (!kind) {
      const originalExt = file.originalname.toLowerCase().split(".").pop();
      const extToKind: Record<string, "jpeg" | "png" | "webp" | "gif"> = {
        jpg: "jpeg",
        jpeg: "jpeg",
        png: "png",
        webp: "webp",
        gif: "gif"
      };
      kind = extToKind[originalExt || ""];
    }

    if (!kind) {
      console.error(
        `[admin] fileFilter: Unsupported file type: mimetype=${file.mimetype}, originalname=${file.originalname}`
      );
      return cb(new Error("Nieobsługiwany typ pliku. Dozwolone: JPG/PNG/WEBP/GIF."));
    }
    cb(null, true);
  }
});

export function createAdminRouter(env: Env, emailService: EmailService | null): express.Router {
  const router = express.Router();

  // POST /api/admin/login - endpoint logowania (przed middleware autoryzacji)
  router.post("/login", async (req, res) => {
    try {
      const { token } = req.body;

      if (!token || typeof token !== "string") {
        return res.status(400).json({
          error: "Bad Request",
          message: "Token jest wymagany",
          code: "MISSING_TOKEN"
        });
      }

      if (!env.ADMIN_TOKEN || env.ADMIN_TOKEN.length < 32) {
        return res.status(500).json({
          error: "InternalError",
          message: "Admin token nie jest skonfigurowany",
          code: "TOKEN_NOT_CONFIGURED"
        });
      }

      // Sprawdź czy token jest poprawny
      if (token !== env.ADMIN_TOKEN) {
        return res.status(401).json({
          error: "Unauthorized",
          message: "Nieprawidłowy token",
          code: "INVALID_TOKEN"
        });
      }

      // Generuj JWT (ważny przez 24 godziny)
      const jwtSecret = env.ADMIN_TOKEN; // Używamy ADMIN_TOKEN jako secret dla JWT
      const jwtToken = jwt.sign({ admin: true }, jwtSecret, { expiresIn: "24h" });

      // Ustaw JWT w HttpOnly cookie
      // Dla cross-origin (np. localhost → onrender.com) potrzebujemy sameSite: "none" + secure: true
      // Dla same-origin możemy użyć sameSite: "strict"
      const isProduction = env.NODE_ENV === "production";
      const requestOrigin = req.headers.origin || "";
      const serverPublicUrl = env.SERVER_PUBLIC_URL || `http://localhost:${env.PORT}`;

      // Sprawdź czy request pochodzi z innej domeny niż backend
      let isCrossOrigin = false;
      if (requestOrigin) {
        try {
          const requestUrl = new URL(requestOrigin);
          const serverUrl = new URL(serverPublicUrl);
          // Cross-origin jeśli różne hosty (np. localhost:5173 vs dream-travel-sport.onrender.com)
          isCrossOrigin =
            requestUrl.hostname !== serverUrl.hostname || requestUrl.port !== serverUrl.port;
        } catch {
          // Jeśli nie można sparsować URL, zakładamy same-origin
          isCrossOrigin = false;
        }
      }

      const sameSite = isCrossOrigin ? "none" : "strict";
      // SameSite: "none" WYMAGA Secure: true (wymóg przeglądarki)
      // W produkcji zawsze używamy Secure (HTTPS)
      const secure = sameSite === "none" || isProduction;

      const cookieOptions = {
        httpOnly: true,
        secure: secure, // Secure wymagane dla sameSite: "none" i w produkcji
        sameSite: sameSite as "none" | "strict" | "lax", // "none" dla cross-origin, "strict" dla same-origin
        path: "/", // Cookie dostępny dla wszystkich ścieżek
        maxAge: 24 * 60 * 60 * 1000 // 24 godziny
      };

      // Logowanie dla debugowania - zawsze loguj w produkcji dla tego problemu
      console.log(
        `[admin] Login - origin: ${requestOrigin || "none"}, server: ${serverPublicUrl}, cross-origin: ${isCrossOrigin}, NODE_ENV: ${env.NODE_ENV}, cookie options:`,
        JSON.stringify(cookieOptions, null, 2)
      );

      res.cookie("adminToken", jwtToken, cookieOptions);

      res.json({
        success: true,
        message: "Zalogowano pomyślnie"
      });
    } catch (err) {
      console.error("[admin] Login error:", err);
      res.status(500).json({
        error: "InternalError",
        message: "Wystąpił błąd podczas logowania",
        code: "LOGIN_ERROR"
      });
    }
  });

  // POST /api/admin/logout - endpoint wylogowania (przed middleware autoryzacji)
  router.post("/logout", (req, res) => {
    // Przy czyszczeniu cookie musimy użyć tych samych opcji co przy ustawianiu
    const requestOrigin = req.headers.origin || "";
    const serverPublicUrl = env.SERVER_PUBLIC_URL || `http://localhost:${env.PORT}`;

    let isCrossOrigin = false;
    if (requestOrigin) {
      try {
        const requestUrl = new URL(requestOrigin);
        const serverUrl = new URL(serverPublicUrl);
        isCrossOrigin =
          requestUrl.hostname !== serverUrl.hostname || requestUrl.port !== serverUrl.port;
      } catch {
        isCrossOrigin = false;
      }
    }
    const isProduction = env.NODE_ENV === "production";
    const sameSite = isCrossOrigin ? "none" : "strict";
    const secure = sameSite === "none" || isProduction;

    res.clearCookie("adminToken", {
      httpOnly: true,
      secure: secure,
      sameSite: sameSite as "none" | "strict" | "lax",
      path: "/" // Musi być taka sama jak przy ustawianiu
    });
    res.json({
      success: true,
      message: "Wylogowano pomyślnie"
    });
  });

  // Wszystkie pozostałe endpointy wymagają autentykacji admina
  router.use(createAdminAuthMiddleware(env));

  function uploadSingleImage(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) {
    upload.single("image")(req, res, (err) => {
      if (err) {
        return res.status(400).json({
          error: "ValidationError",
          message: err instanceof Error ? err.message : "Upload failed",
          code: "UPLOAD_ERROR"
        });
      }
      next();
    });
  }

  // POST /api/admin/upload - upload obrazu
  router.post("/upload", uploadSingleImage, (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          error: "Bad Request",
          message: "Brak pliku do uploadu",
          code: "MISSING_FILE"
        });
      }

      const expectedKind = ALLOWED_IMAGE_MIME[req.file.mimetype];
      const absPath = resolveUploadFilePath(req.file.filename);
      const detectedKind = verifyUploadedImage(absPath);
      if (!expectedKind || !detectedKind) {
        try {
          if (existsSync(absPath)) {
            unlinkSync(absPath);
          }
        } catch {}
        return res.status(400).json({
          error: "ValidationError",
          message: "Plik nie jest poprawnym obrazem (JPG/PNG/WEBP/GIF).",
          code: "INVALID_IMAGE"
        });
      }

      // Log if detected type doesn't match expected type (but still accept it)
      if (detectedKind !== expectedKind) {
        console.warn(
          `[admin] Image type mismatch: expected=${expectedKind} (from MIME type), detected=${detectedKind} (from file header). File will be accepted.`
        );
      }

      // Zwróć ścieżkę względną do pliku (będzie dostępna przez /assets/trips/filename)
      const filePath = `/assets/trips/${req.file.filename}`;

      res.json({
        success: true,
        path: filePath,
        filename: req.file.filename
      });
    } catch (err) {
      next(err);
    }
  });

  // DELETE /api/admin/upload/:filename - usuwanie obrazu
  router.delete("/upload/:filename", (req, res, next) => {
    try {
      const filename = req.params.filename;
      if (!filename) {
        return res.status(400).json({
          error: "Bad Request",
          message: "Brak nazwy pliku",
          code: "MISSING_FILENAME"
        });
      }

      if (!isSafeUploadFilename(filename)) {
        return res.status(400).json({
          error: "ValidationError",
          message: "Nieprawidłowa nazwa pliku",
          code: "INVALID_FILENAME"
        });
      }

      // Usuń plik
      const filePath = resolveUploadFilePath(filename);
      if (existsSync(filePath)) {
        unlinkSync(filePath);
        res.json({
          success: true,
          message: "Plik został usunięty"
        });
      } else {
        res.status(404).json({
          error: "Not Found",
          message: "Plik nie został znaleziony",
          code: "FILE_NOT_FOUND"
        });
      }
    } catch (err) {
      next(err);
    }
  });

  // GET /api/admin/stats - podstawowe statystyki
  router.get("/stats", async (_req, res, next) => {
    try {
      const overdueHours = env.MANUAL_TRANSFER_OVERDUE_HOURS ?? 48;
      const overdueCutoff = new Date(Date.now() - overdueHours * 60 * 60 * 1000);

      const [
        totalTrips,
        totalOrders,
        totalUsers,
        totalNewsletterSubscribers,
        totalRevenue,
        pendingOrders,
        paidOrders,
        overdueManualTransfers
      ] = await Promise.all([
        prisma.trip.count(),
        prisma.order.count(),
        prisma.user.count(),
        prisma.newsletterSubscriber.count({
          where: { status: "CONFIRMED" }
        }),
        prisma.order.aggregate({
          where: {
            status: { in: ["SUBMITTED", "CONFIRMED"] },
            payments: {
              some: {
                status: "PAID"
              }
            }
          },
          _sum: {
            totalCents: true
          }
        }),
        prisma.order.count({
          where: { status: "SUBMITTED" }
        }),
        prisma.order.count({
          where: {
            status: { in: ["SUBMITTED", "CONFIRMED"] },
            payments: {
              some: {
                status: "PAID"
              }
            }
          }
        }),
        prisma.order.count({
          where: {
            status: OrderStatus.SUBMITTED,
            submittedAt: { lt: overdueCutoff },
            payments: {
              some: { provider: PaymentProvider.MANUAL_TRANSFER, status: PaymentStatus.PENDING },
              none: { status: PaymentStatus.PAID }
            }
          }
        })
      ]);

      res.json({
        trips: {
          total: totalTrips
        },
        orders: {
          total: totalOrders,
          pending: pendingOrders,
          paid: paidOrders,
          overdueManualTransfers,
          overdueManualTransfersHours: overdueHours
        },
        users: {
          total: totalUsers
        },
        newsletter: {
          subscribers: totalNewsletterSubscribers
        },
        revenue: {
          totalCents: totalRevenue._sum.totalCents ?? 0
        }
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          error: "Validation error",
          message: "Invalid query parameters",
          details: err.errors.map((e) => ({
            path: e.path.join("."),
            message: e.message
          }))
        });
      }
      next(err);
    }
  });

  // GET /api/admin/orders - lista zamówień
  router.get("/orders", async (req, res, next) => {
    try {
      const querySchema = z.object({
        page: z
          .string()
          .optional()
          .transform((val) => (val ? parseInt(val, 10) : 1))
          .pipe(z.number().int().min(1).max(10000)),
        limit: z
          .string()
          .optional()
          .transform((val) => (val ? parseInt(val, 10) : 50))
          .pipe(z.number().int().min(1).max(100)),
        status: z
          .string()
          .optional()
          .transform((val) => (val && val.trim() !== "" ? val : undefined))
          .pipe(z.enum(["SUBMITTED", "CONFIRMED", "CANCELLED"]).optional()),
        overdueManualTransfers: z
          .string()
          .optional()
          .transform((val) => {
            if (!val) return undefined;
            const v = val.trim().toLowerCase();
            if (v === "true" || v === "1" || v === "yes") return true;
            if (v === "false" || v === "0" || v === "no") return false;
            return undefined;
          })
          .pipe(z.boolean().optional())
      });

      const query = querySchema.parse(req.query);
      const page = query.page;
      const limit = query.limit;
      const skip = (page - 1) * limit;

      let where: any = query.status ? { status: query.status } : {};

      if (query.overdueManualTransfers) {
        const overdueHours = env.MANUAL_TRANSFER_OVERDUE_HOURS ?? 48;
        const overdueCutoff = new Date(Date.now() - overdueHours * 60 * 60 * 1000);
        where = {
          status: OrderStatus.SUBMITTED,
          submittedAt: { lt: overdueCutoff },
          payments: {
            some: { provider: PaymentProvider.MANUAL_TRANSFER, status: PaymentStatus.PENDING },
            none: { status: PaymentStatus.PAID }
          }
        };
      }

      const [orders, total] = await Promise.all([
        prisma.order.findMany({
          where,
          select: {
            id: true,
            orderNumber: true,
            status: true,
            customerName: true,
            customerEmail: true,
            customerPhone: true,
            totalCents: true,
            currency: true,
            submittedAt: true,
            createdAt: true,
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
            },
            payments: {
              select: {
                id: true,
                provider: true,
                status: true,
                amountCents: true,
                paidAt: true
              }
            }
          },
          orderBy: { createdAt: "desc" },
          skip,
          take: limit
        }),
        prisma.order.count({ where })
      ]);

      res.json({
        data: orders,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          error: "Validation error",
          message: "Invalid query parameters",
          details: err.errors.map((e) => ({
            path: e.path.join("."),
            message: e.message
          }))
        });
      }
      next(err);
    }
  });

  // GET /api/admin/orders/:id - szczegóły zamówienia
  router.get("/orders/:id", async (req, res, next) => {
    try {
      const { id } = req.params;

      const order = await prisma.order.findUnique({
        where: { id },
        select: {
          id: true,
          orderNumber: true,
          status: true,
          customerName: true,
          customerEmail: true,
          customerPhone: true,
          invoiceType: true,
          companyName: true,
          companyTaxId: true,
          companyAddress: true,
          totalCents: true,
          currency: true,
          submittedAt: true,
          createdAt: true,
          updatedAt: true,
          items: {
            select: {
              id: true,
              tripId: true,
              departurePointId: true,
              qty: true,
              unitPriceCents: true,
              currency: true,
              trip: {
                select: {
                  id: true,
                  name: true,
                  slug: true,
                  priceCents: true
                }
              },
              departurePoint: {
                select: {
                  id: true,
                  city: true,
                  priceCents: true
                }
              },
              passengers: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  birthDate: true,
                  documentType: true,
                  documentNumber: true
                }
              }
            }
          },
          payments: {
            select: {
              id: true,
              provider: true,
              status: true,
              amountCents: true,
              currency: true,
              externalId: true,
              paidAt: true,
              createdAt: true,
              updatedAt: true
            }
          },
          user: {
            select: {
              id: true,
              email: true,
              createdAt: true
            }
          },
          checkoutSession: {
            select: {
              id: true,
              status: true,
              pointsReserved: true
            }
          }
        }
      });

      if (!order) {
        throw new NotFoundError("Order");
      }

      res.json(order);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/admin/orders/:id/manual-transfer/mark-paid - ręczne zaksięgowanie przelewu tradycyjnego
  router.post("/orders/:id/manual-transfer/mark-paid", async (req, res, next) => {
    try {
      const { id } = req.params;

      const result = await prisma.$transaction(async (tx) => {
        const order = await tx.order.findUnique({
          where: { id },
          include: {
            items: true,
            payments: true,
            checkoutSession: true,
            user: { include: { loyaltyAccount: true } }
          }
        });

        if (!order) {
          throw new NotFoundError("Order");
        }

        if (order.status === OrderStatus.CANCELLED) {
          throw new ConflictError("Order is cancelled");
        }

        const hasPaidP24 = order.payments.some(
          (p) => p.provider === PaymentProvider.PRZELEWY24 && p.status === PaymentStatus.PAID
        );
        if (hasPaidP24) {
          throw new ConflictError("Order already paid via Przelewy24");
        }

        const hasManualTransfer = order.payments.some(
          (p) => p.provider === PaymentProvider.MANUAL_TRANSFER
        );
        if (!hasManualTransfer) {
          throw new ValidationError("Order has no MANUAL_TRANSFER payment");
        }

        // Idempotencja: jeśli już jest opłacone przelewem, nie rób nic
        const alreadyPaidManual = order.payments.find(
          (p) => p.provider === PaymentProvider.MANUAL_TRANSFER && p.status === PaymentStatus.PAID
        );

        let paymentId: string | null = alreadyPaidManual?.id ?? null;
        const wasAlreadyPaid = Boolean(alreadyPaidManual);
        let earnedApplied = 0;

        if (!alreadyPaidManual) {
          // Zaksięguj najnowszą płatność MANUAL_TRANSFER (albo utwórz jeśli brak)
          const manualPayments = order.payments
            .filter((p) => p.provider === PaymentProvider.MANUAL_TRANSFER)
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
          const latest = manualPayments[0];

          if (latest) {
            const updated = await tx.payment.update({
              where: { id: latest.id },
              data: {
                status: PaymentStatus.PAID,
                paidAt: new Date(),
                raw: {
                  ...(latest.raw && typeof latest.raw === "object" && !Array.isArray(latest.raw)
                    ? (latest.raw as Record<string, unknown>)
                    : { previousRaw: latest.raw }),
                  admin: { markedPaidAt: new Date().toISOString() }
                } as any
              }
            });
            paymentId = updated.id;

            // Porządek: anuluj pozostałe PENDING
            await tx.payment.updateMany({
              where: {
                orderId: order.id,
                provider: PaymentProvider.MANUAL_TRANSFER,
                status: PaymentStatus.PENDING,
                id: { not: updated.id }
              },
              data: { status: PaymentStatus.CANCELLED }
            });
          } else {
            const created = await tx.payment.create({
              data: {
                orderId: order.id,
                provider: PaymentProvider.MANUAL_TRANSFER,
                status: PaymentStatus.PAID,
                amountCents: order.totalCents,
                currency: order.currency,
                paidAt: new Date(),
                raw: { admin: { markedPaidAt: new Date().toISOString() } } as any
              }
            });
            paymentId = created.id;
          }
        }

        // Oznacz zamówienie jako CONFIRMED
        const updatedOrder = await tx.order.update({
          where: { id: order.id },
          data: { status: OrderStatus.CONFIRMED }
        });

        // Punkty lojalnościowe: nalicz/odejmij dokładnie raz (idempotencja po orderId)
        if (order.user?.loyaltyAccount) {
          const account = order.user.loyaltyAccount;

          const existingTxn = await tx.loyaltyTransaction.findFirst({
            where: { orderId: order.id, accountId: account.id }
          });

          if (!existingTxn) {
            const pointsUsed = order.checkoutSession?.pointsReserved ?? 0;

            // 1) Odejmij użyte punkty (jeśli były użyte)
            if (pointsUsed > 0) {
              await tx.loyaltyTransaction.create({
                data: {
                  accountId: account.id,
                  type: LoyaltyTxnType.SPEND,
                  points: -pointsUsed,
                  note: `Użycie punktów w zamówieniu ${order.orderNumber}`,
                  orderId: order.id
                }
              });

              await tx.loyaltyAccount.update({
                where: { id: account.id },
                data: { pointsBalance: { decrement: pointsUsed } }
              });
            }

            // 2) Nalicz nowe punkty (10% wartości zamówienia PRZED zniżką z punktów)
            // 10% wartości zamówienia PO zniżce (1 punkt = 1 zł).
            // order.totalCents jest już po zniżce i jest w groszach, więc / 1000 daje punkty.
            const pointsToEarn = Math.floor(order.totalCents / 1000);

            if (pointsToEarn > 0) {
              const expiresAt = calculateExpirationDate(new Date());

              await tx.loyaltyTransaction.create({
                data: {
                  accountId: account.id,
                  type: LoyaltyTxnType.EARN,
                  points: pointsToEarn,
                  note: `Naliczono punkty za zamówienie ${order.orderNumber} (10% wartości)`,
                  orderId: order.id,
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
        }

        return {
          orderId: updatedOrder.id,
          orderNumber: updatedOrder.orderNumber,
          orderStatus: updatedOrder.status,
          paymentId,
          wasAlreadyPaid,
          earnedApplied,
          customerEmail: order.customerEmail,
          customerName: order.customerName,
          totalCents: order.totalCents,
          currency: order.currency
        };
      });

      // Email: potwierdzenie płatności (tylko przy pierwszym zaksięgowaniu)
      let emailSent = false;
      if (emailService && !result.wasAlreadyPaid) {
        try {
          await emailService.sendPaymentConfirmation({
            to: result.customerEmail,
            customerName: result.customerName || result.customerEmail,
            orderNumber: result.orderNumber,
            totalCents: result.totalCents,
            currency: result.currency,
            pointsEarned: result.earnedApplied
          });
          emailSent = true;
        } catch (emailErr) {
          console.error("[admin] Failed to send payment confirmation email:", emailErr);
          // Nie blokuj odpowiedzi dla admina
        }
      }

      return res.json({ success: true, emailSent, ...result });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/admin/orders/:id/manual-transfer/cancel - ręczne anulowanie zamówienia z przelewem tradycyjnym
  router.post("/orders/:id/manual-transfer/cancel", async (req, res, next) => {
    try {
      const { id } = req.params;

      const result = await prisma.$transaction(async (tx) => {
        const order = await tx.order.findUnique({
          where: { id },
          include: {
            items: true,
            payments: true,
            checkoutSession: true
          }
        });

        if (!order) throw new NotFoundError("Order");

        if (order.status === OrderStatus.CANCELLED) {
          return { orderId: order.id, orderNumber: order.orderNumber, orderStatus: order.status };
        }

        const hasPaid = order.payments.some((p) => p.status === PaymentStatus.PAID);
        if (hasPaid) {
          throw new ConflictError("Order already paid - cannot cancel");
        }

        const hasManualTransfer = order.payments.some(
          (p) => p.provider === PaymentProvider.MANUAL_TRANSFER
        );
        if (!hasManualTransfer) {
          throw new ValidationError("Order has no MANUAL_TRANSFER payment");
        }

        // 1) Anuluj zamówienie
        const updatedOrder = await tx.order.update({
          where: { id: order.id },
          data: { status: OrderStatus.CANCELLED }
        });

        // 2) Anuluj płatności przelewu tradycyjnego
        await tx.payment.updateMany({
          where: {
            orderId: order.id,
            provider: PaymentProvider.MANUAL_TRANSFER,
            status: { not: PaymentStatus.PAID }
          },
          data: { status: PaymentStatus.CANCELLED }
        });

        // 3) Zwróć miejsca do puli
        for (const item of order.items) {
          const trip = await tx.trip.findUnique({
            where: { id: item.tripId },
            select: { id: true, seatsLeft: true, capacity: true, availability: true }
          });
          if (!trip) continue;

          const unclamped = trip.seatsLeft + item.qty;
          const newSeatsLeft = Math.min(trip.capacity, unclamped);

          let nextAvailability = trip.availability;
          if (newSeatsLeft === 0) {
            nextAvailability = TripAvailability.CLOSED;
          } else if (trip.availability === TripAvailability.CLOSED) {
            nextAvailability = TripAvailability.OPEN;
          }

          await tx.trip.update({
            where: { id: trip.id },
            data: { seatsLeft: newSeatsLeft, availability: nextAvailability }
          });
        }

        // 4) Zwolnij punkty zarezerwowane i oznacz sesję jako CANCELLED (jeśli istnieje)
        if (order.checkoutSession) {
          await tx.checkoutSession.update({
            where: { id: order.checkoutSession.id },
            data: {
              status: CheckoutSessionStatus.CANCELLED,
              pointsReserved: 0
            }
          });
        }

        return {
          orderId: updatedOrder.id,
          orderNumber: updatedOrder.orderNumber,
          orderStatus: updatedOrder.status
        };
      });

      return res.json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/admin/trips - lista wyjazdów
  router.get("/trips", async (req, res, next) => {
    try {
      const querySchema = z.object({
        page: z
          .string()
          .optional()
          .transform((val) => (val ? parseInt(val, 10) : 1))
          .pipe(z.number().int().min(1).max(10000)),
        limit: z
          .string()
          .optional()
          .transform((val) => (val ? parseInt(val, 10) : 50))
          .pipe(z.number().int().min(1).max(100))
      });

      const query = querySchema.parse(req.query);
      const page = query.page;
      const limit = query.limit;
      const skip = (page - 1) * limit;

      const [trips, total] = await Promise.all([
        prisma.trip.findMany({
          select: {
            id: true,
            slug: true,
            name: true,
            details: true,
            tag: true,
            meta: true,
            startsAt: true,
            endsAt: true,
            currency: true,
            priceCents: true,
            capacity: true,
            seatsLeft: true,
            availability: true,
            spotsLabel: true,
            useAutoSpotsLabel: true,
            hotelClass: true,
            isFeatured: true,
            isActive: true,
            heroImagePath: true,
            cardImagePath: true,
            createdAt: true,
            updatedAt: true,
            _count: {
              select: {
                orderItems: true
              }
            }
          },
          orderBy: { createdAt: "desc" },
          skip,
          take: limit
        }),
        prisma.trip.count()
      ]);

      // Pobierz miejsca wylotu dla wszystkich wyjazdów i oblicz najtańszą cenę
      const tripIds = trips.map((t) => t.id);
      const departurePoints = await prisma.departurePoint.findMany({
        where: {
          tripId: { in: tripIds },
          isActive: true
        },
        select: {
          tripId: true,
          priceCents: true
        }
      });

      // Grupuj miejsca wylotu po tripId i znajdź najtańszą cenę dla każdego wyjazdu
      const minPriceByTrip = new Map<string, number>();
      departurePoints.forEach((dp) => {
        const existing = minPriceByTrip.get(dp.tripId);
        if (!existing || dp.priceCents < existing) {
          minPriceByTrip.set(dp.tripId, dp.priceCents);
        }
      });

      // Zaktualizuj ceny w trips - użyj najtańszej z DeparturePoint lub fallback do priceCents
      const tripsWithPrices = trips.map((trip) => ({
        ...trip,
        priceCents: minPriceByTrip.get(trip.id) ?? trip.priceCents
      }));

      res.json({
        data: tripsWithPrices,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          error: "Validation error",
          message: "Invalid query parameters",
          details: err.errors.map((e) => ({
            path: e.path.join("."),
            message: e.message
          }))
        });
      }
      next(err);
    }
  });

  // GET /api/admin/trips/:id - pojedynczy wyjazd
  router.get("/trips/:id", async (req, res, next) => {
    try {
      const trip = await prisma.trip.findUnique({
        where: { id: req.params.id },
        select: {
          id: true,
          slug: true,
          name: true,
          details: true,
          extendedDescription: true,
          tag: true,
          meta: true,
          startsAt: true,
          endsAt: true,
          currency: true,
          priceCents: true,
          capacity: true,
          seatsLeft: true,
          availability: true,
          spotsLabel: true,
          useAutoSpotsLabel: true,
          hotelClass: true,
          isFeatured: true,
          isActive: true,
          heroImagePath: true,
          cardImagePath: true,
          createdAt: true,
          updatedAt: true
        }
      });

      if (!trip) {
        throw new NotFoundError("Trip");
      }

      // Pobierz miejsca wylotu dla tego wyjazdu
      const departurePoints = await prisma.departurePoint.findMany({
        where: { tripId: trip.id },
        select: {
          id: true,
          city: true,
          priceCents: true,
          currency: true,
          isActive: true,
          sortOrder: true,
          createdAt: true,
          updatedAt: true
        },
        orderBy: { sortOrder: "asc" }
      });

      res.json({
        ...trip,
        departurePoints
      });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/admin/trips - tworzenie wyjazdu
  router.post("/trips", async (req, res, next) => {
    try {
      const createSchema = z.object({
        name: z.string().min(1).max(500),
        details: z.string().min(1),
        extendedDescription: z.string().min(1),
        tag: z.string().min(1).max(100),
        meta: z.string().min(1).max(500),
        startsAt: z.string().datetime(),
        endsAt: z.string().datetime(),
        currency: z.string().default("PLN"),
        priceCents: z.number().int().min(0).optional().nullable(), // Opcjonalne - cena będzie w DeparturePoint
        capacity: z.number().int().min(0),
        seatsLeft: z.number().int().min(0),
        availability: z.enum(["OPEN", "WAITLIST", "CLOSED"]).default("OPEN"),
        spotsLabel: z.string().optional().nullable(),
        useAutoSpotsLabel: z.boolean().default(false),
        hotelClass: z.number().int().min(1).max(5).optional().nullable(),
        isFeatured: z.boolean().default(false),
        heroImagePath: z.string().optional().nullable(),
        cardImagePath: z.string().optional().nullable()
      });

      const data = createSchema.parse(req.body);

      // Generuj slug z nazwy
      let slug = generateSlug(data.name);
      if (!slug || slug.length === 0) {
        throw new ValidationError("Nie można wygenerować slug z nazwy wyjazdu", {
          name: data.name
        });
      }

      // Sprawdź unikalność slug i dodaj numerację jeśli trzeba
      let finalSlug = slug;
      let counter = 1;
      while (true) {
        const existingTrip = await prisma.trip.findUnique({
          where: { slug: finalSlug }
        });
        if (!existingTrip) {
          break;
        }
        finalSlug = `${slug}-${counter}`;
        counter++;
        // Zabezpieczenie przed nieskończoną pętlą
        if (counter > 1000) {
          throw new ValidationError("Nie można wygenerować unikalnego slug", {
            name: data.name
          });
        }
      }

      // Dodaj wygenerowany slug do danych
      const tripData = {
        ...data,
        slug: finalSlug
      };

      // Walidacja dat
      const startsAt = new Date(data.startsAt);
      const endsAt = new Date(data.endsAt);
      if (endsAt < startsAt) {
        throw new ValidationError(
          "Data zakończenia nie może być wcześniejsza niż data rozpoczęcia",
          {
            startsAt: data.startsAt,
            endsAt: data.endsAt
          }
        );
      }

      // Walidacja miejsc
      if (data.capacity < 0) {
        throw new ValidationError("Pojemność nie może być ujemna", {
          capacity: data.capacity
        });
      }
      if (data.seatsLeft < 0) {
        throw new ValidationError("Liczba wolnych miejsc nie może być ujemna", {
          seatsLeft: data.seatsLeft
        });
      }
      if (data.seatsLeft > data.capacity) {
        throw new ValidationError("Liczba wolnych miejsc nie może być większa niż pojemność", {
          capacity: data.capacity,
          seatsLeft: data.seatsLeft
        });
      }

      const trip = await prisma.trip.create({
        data: {
          ...tripData,
          ...(tripData.startsAt && { startsAt: new Date(tripData.startsAt) }),
          ...(tripData.endsAt && { endsAt: new Date(tripData.endsAt) })
        },
        select: {
          id: true,
          slug: true,
          name: true,
          details: true,
          extendedDescription: true,
          tag: true,
          meta: true,
          startsAt: true,
          endsAt: true,
          currency: true,
          priceCents: true,
          capacity: true,
          seatsLeft: true,
          availability: true,
          spotsLabel: true,
          isFeatured: true,
          isActive: true,
          heroImagePath: true,
          cardImagePath: true,
          createdAt: true,
          updatedAt: true
        }
      });

      res.status(201).json(trip);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          error: "Validation error",
          message: "Invalid request data",
          details: err.errors.map((e) => ({
            path: e.path.join("."),
            message: e.message
          }))
        });
      }
      next(err);
    }
  });

  // PUT /api/admin/trips/:id - edycja wyjazdu
  router.put("/trips/:id", async (req, res, next) => {
    try {
      const updateSchema = z.object({
        name: z.string().min(1).max(500).optional(),
        details: z.string().min(1).optional(),
        extendedDescription: z.string().min(1).optional(),
        tag: z.string().min(1).max(100).optional(),
        meta: z.string().min(1).max(500).optional(),
        startsAt: z.string().datetime().optional(),
        endsAt: z.string().datetime().optional(),
        currency: z.string().optional(),
        priceCents: z.number().int().min(0).optional(),
        capacity: z.number().int().min(0).optional(),
        seatsLeft: z.number().int().min(0).optional(),
        availability: z.enum(["OPEN", "WAITLIST", "CLOSED"]).optional(),
        spotsLabel: z.string().optional().nullable(),
        useAutoSpotsLabel: z.boolean().optional(),
        hotelClass: z.number().int().min(1).max(5).optional().nullable(),
        isFeatured: z.boolean().optional(),
        heroImagePath: z.string().optional().nullable(),
        cardImagePath: z.string().optional().nullable()
      });

      const data = updateSchema.parse(req.body);

      // Sprawdź czy wyjazd istnieje
      const existingTrip = await prisma.trip.findUnique({
        where: { id: req.params.id }
      });

      if (!existingTrip) {
        throw new NotFoundError("Trip");
      }

      // Jeśli nazwa się zmienia, wygeneruj nowy slug
      const updateData: typeof data & { slug?: string } = { ...data };
      if (data.name && data.name !== existingTrip.name) {
        let slug = generateSlug(data.name);
        if (!slug || slug.length === 0) {
          throw new ValidationError("Nie można wygenerować slug z nazwy wyjazdu", {
            name: data.name
          });
        }

        // Sprawdź unikalność slug i dodaj numerację jeśli trzeba
        let finalSlug = slug;
        let counter = 1;
        while (true) {
          const existingTripWithSlug = await prisma.trip.findUnique({
            where: { slug: finalSlug }
          });
          // Jeśli slug jest taki sam jak obecny, nie trzeba go zmieniać
          if (existingTripWithSlug?.id === existingTrip.id) {
            break;
          }
          // Jeśli slug jest wolny, użyj go
          if (!existingTripWithSlug) {
            break;
          }
          finalSlug = `${slug}-${counter}`;
          counter++;
          // Zabezpieczenie przed nieskończoną pętlą
          if (counter > 1000) {
            throw new ValidationError("Nie można wygenerować unikalnego slug", {
              name: data.name
            });
          }
        }
        updateData.slug = finalSlug;
      }

      // Użyj nowych wartości lub istniejących (w edycji pola są opcjonalne, ale jeśli istnieją w bazie, użyj ich)
      const startsAt =
        data.startsAt !== undefined ? new Date(data.startsAt) : existingTrip.startsAt;
      const endsAt = data.endsAt !== undefined ? new Date(data.endsAt) : existingTrip.endsAt;
      const capacity = data.capacity !== undefined ? data.capacity : existingTrip.capacity;
      const seatsLeft = data.seatsLeft !== undefined ? data.seatsLeft : existingTrip.seatsLeft;

      // Walidacja dat
      if (endsAt < startsAt) {
        throw new ValidationError(
          "Data zakończenia nie może być wcześniejsza niż data rozpoczęcia",
          {
            startsAt: data.startsAt || existingTrip.startsAt,
            endsAt: data.endsAt || existingTrip.endsAt
          }
        );
      }

      // Walidacja miejsc
      if (capacity < 0) {
        throw new ValidationError("Pojemność nie może być ujemna", {
          capacity
        });
      }
      if (seatsLeft < 0) {
        throw new ValidationError("Liczba wolnych miejsc nie może być ujemna", {
          seatsLeft
        });
      }
      if (seatsLeft > capacity) {
        throw new ValidationError("Liczba wolnych miejsc nie może być większa niż pojemność", {
          capacity,
          seatsLeft
        });
      }

      // Usuń stare obrazy jeśli zostały zmienione lub usunięte
      if (updateData.heroImagePath !== undefined) {
        // Jeśli nowa ścieżka jest różna od starej (lub null), usuń stary plik
        if (updateData.heroImagePath !== existingTrip.heroImagePath && existingTrip.heroImagePath) {
          deleteImageFile(existingTrip.heroImagePath);
        }
      }

      if (updateData.cardImagePath !== undefined) {
        // Jeśli nowa ścieżka jest różna od starej (lub null), usuń stary plik
        if (updateData.cardImagePath !== existingTrip.cardImagePath && existingTrip.cardImagePath) {
          deleteImageFile(existingTrip.cardImagePath);
        }
      }

      const trip = await prisma.trip.update({
        where: { id: req.params.id },
        data: {
          ...updateData,
          startsAt: startsAt,
          endsAt: endsAt,
          capacity: capacity,
          seatsLeft: seatsLeft
        },
        select: {
          id: true,
          slug: true,
          name: true,
          details: true,
          extendedDescription: true,
          tag: true,
          meta: true,
          startsAt: true,
          endsAt: true,
          currency: true,
          priceCents: true,
          capacity: true,
          seatsLeft: true,
          availability: true,
          spotsLabel: true,
          useAutoSpotsLabel: true,
          hotelClass: true,
          isFeatured: true,
          isActive: true,
          heroImagePath: true,
          cardImagePath: true,
          createdAt: true,
          updatedAt: true
        }
      });

      res.json(trip);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          error: "Validation error",
          message: "Invalid request data",
          details: err.errors.map((e) => ({
            path: e.path.join("."),
            message: e.message
          }))
        });
      }
      next(err);
    }
  });

  // PATCH /api/admin/trips/:id/deactivate - deaktywacja wyjazdu
  router.patch("/trips/:id/deactivate", async (req, res, next) => {
    try {
      const trip = await prisma.trip.findUnique({
        where: { id: req.params.id }
      });

      if (!trip) {
        throw new NotFoundError("Trip");
      }

      await prisma.trip.update({
        where: { id: req.params.id },
        data: { isActive: false }
      });

      res.status(200).json({ message: "Trip deactivated" });
    } catch (err) {
      next(err);
    }
  });

  // PATCH /api/admin/trips/:id/activate - aktywacja wyjazdu
  router.patch("/trips/:id/activate", async (req, res, next) => {
    try {
      const trip = await prisma.trip.findUnique({
        where: { id: req.params.id }
      });

      if (!trip) {
        throw new NotFoundError("Trip");
      }

      await prisma.trip.update({
        where: { id: req.params.id },
        data: { isActive: true }
      });

      res.status(200).json({ message: "Trip activated" });
    } catch (err) {
      next(err);
    }
  });

  // CRUD dla miejsc wylotu (Departure Points)
  // POST /api/admin/trips/:id/departure-points - tworzenie miejsca wylotu
  router.post("/trips/:id/departure-points", async (req, res, next) => {
    try {
      // Sprawdź czy wyjazd istnieje
      const trip = await prisma.trip.findUnique({
        where: { id: req.params.id }
      });
      if (!trip) {
        throw new NotFoundError("Trip");
      }

      const createSchema = z.object({
        city: z.string().min(1).max(100),
        priceCents: z.number().int().min(0),
        currency: z.string().default("PLN"),
        isActive: z.boolean().default(true),
        sortOrder: z.number().int().default(0)
      });

      const data = createSchema.parse(req.body);

      const departurePoint = await prisma.departurePoint.create({
        data: {
          tripId: trip.id,
          city: data.city,
          priceCents: data.priceCents,
          currency: data.currency,
          isActive: data.isActive,
          sortOrder: data.sortOrder
        },
        select: {
          id: true,
          city: true,
          priceCents: true,
          currency: true,
          isActive: true,
          sortOrder: true,
          createdAt: true,
          updatedAt: true
        }
      });

      res.status(201).json(departurePoint);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          error: "Validation error",
          message: "Invalid request data",
          details: err.errors.map((e) => ({
            path: e.path.join("."),
            message: e.message
          }))
        });
      }
      next(err);
    }
  });

  // PUT /api/admin/trips/:id/departure-points/:departurePointId - edycja miejsca wylotu
  router.put("/trips/:id/departure-points/:departurePointId", async (req, res, next) => {
    try {
      // Sprawdź czy wyjazd istnieje
      const trip = await prisma.trip.findUnique({
        where: { id: req.params.id }
      });
      if (!trip) {
        throw new NotFoundError("Trip");
      }

      // Sprawdź czy miejsce wylotu istnieje i należy do tego wyjazdu
      const existingDeparturePoint = await prisma.departurePoint.findUnique({
        where: { id: req.params.departurePointId }
      });
      if (!existingDeparturePoint) {
        throw new NotFoundError("DeparturePoint");
      }
      if (existingDeparturePoint.tripId !== trip.id) {
        return res.status(400).json({
          error: "Validation error",
          message: "Departure point does not belong to this trip"
        });
      }

      const updateSchema = z.object({
        city: z.string().min(1).max(100).optional(),
        priceCents: z.number().int().min(0).optional(),
        currency: z.string().optional(),
        isActive: z.boolean().optional(),
        sortOrder: z.number().int().optional()
      });

      const data = updateSchema.parse(req.body);

      const departurePoint = await prisma.departurePoint.update({
        where: { id: req.params.departurePointId },
        data,
        select: {
          id: true,
          city: true,
          priceCents: true,
          currency: true,
          isActive: true,
          sortOrder: true,
          createdAt: true,
          updatedAt: true
        }
      });

      res.json(departurePoint);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          error: "Validation error",
          message: "Invalid request data",
          details: err.errors.map((e) => ({
            path: e.path.join("."),
            message: e.message
          }))
        });
      }
      next(err);
    }
  });

  // DELETE /api/admin/trips/:id/departure-points/:departurePointId - usunięcie miejsca wylotu
  router.delete("/trips/:id/departure-points/:departurePointId", async (req, res, next) => {
    try {
      // Sprawdź czy wyjazd istnieje
      const trip = await prisma.trip.findUnique({
        where: { id: req.params.id }
      });
      if (!trip) {
        throw new NotFoundError("Trip");
      }

      // Sprawdź czy miejsce wylotu istnieje i należy do tego wyjazdu
      const existingDeparturePoint = await prisma.departurePoint.findUnique({
        where: { id: req.params.departurePointId }
      });
      if (!existingDeparturePoint) {
        throw new NotFoundError("DeparturePoint");
      }
      if (existingDeparturePoint.tripId !== trip.id) {
        return res.status(400).json({
          error: "Validation error",
          message: "Departure point does not belong to this trip"
        });
      }

      // Sprawdź czy miejsce wylotu jest używane w zamówieniach
      const orderItemsCount = await prisma.orderItem.count({
        where: { departurePointId: req.params.departurePointId }
      });

      if (orderItemsCount > 0) {
        // Zamiast usuwać, deaktywuj (soft delete)
        await prisma.departurePoint.update({
          where: { id: req.params.departurePointId },
          data: { isActive: false }
        });
        res.status(200).json({ message: "Departure point deactivated (has associated orders)" });
      } else {
        // Usuń fizycznie jeśli nie jest używane
        await prisma.departurePoint.delete({
          where: { id: req.params.departurePointId }
        });
        res.status(200).json({ message: "Departure point deleted" });
      }
    } catch (err) {
      next(err);
    }
  });

  // GET /api/admin/users - lista użytkowników
  router.get("/users", async (req, res, next) => {
    try {
      const querySchema = z.object({
        page: z
          .string()
          .optional()
          .transform((val) => (val ? parseInt(val, 10) : 1))
          .pipe(z.number().int().min(1).max(10000)),
        limit: z
          .string()
          .optional()
          .transform((val) => (val ? parseInt(val, 10) : 50))
          .pipe(z.number().int().min(1).max(100))
      });

      const query = querySchema.parse(req.query);
      const page = query.page;
      const limit = query.limit;
      const skip = (page - 1) * limit;

      const [users, total] = await Promise.all([
        prisma.user.findMany({
          select: {
            id: true,
            email: true,
            createdAt: true,
            updatedAt: true,
            loyaltyAccount: {
              select: {
                id: true,
                pointsBalance: true
              }
            },
            _count: {
              select: {
                orders: true,
                checkoutSessions: true
              }
            }
          },
          orderBy: { createdAt: "desc" },
          skip,
          take: limit
        }),
        prisma.user.count()
      ]);

      res.json({
        data: users,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          error: "Validation error",
          message: "Invalid query parameters",
          details: err.errors.map((e) => ({
            path: e.path.join("."),
            message: e.message
          }))
        });
      }
      next(err);
    }
  });

  // GET /api/admin/newsletter - lista subskrybentów newslettera
  router.get("/newsletter", async (req, res, next) => {
    try {
      const querySchema = z.object({
        page: z
          .string()
          .optional()
          .transform((val) => (val ? parseInt(val, 10) : 1))
          .pipe(z.number().int().min(1).max(10000)),
        limit: z
          .string()
          .optional()
          .transform((val) => (val ? parseInt(val, 10) : 50))
          .pipe(z.number().int().min(1).max(100)),
        status: z
          .string()
          .optional()
          .transform((val) => (val && val.trim() !== "" ? val : undefined))
          .pipe(z.enum(["PENDING", "CONFIRMED", "UNSUBSCRIBED"]).optional())
      });

      const query = querySchema.parse(req.query);
      const page = query.page;
      const limit = query.limit;
      const skip = (page - 1) * limit;

      const where = query.status ? { status: query.status } : {};

      const [subscribers, total] = await Promise.all([
        prisma.newsletterSubscriber.findMany({
          where,
          select: {
            id: true,
            email: true,
            name: true,
            status: true,
            consentAt: true,
            sourcePage: true,
            createdAt: true,
            updatedAt: true
          },
          orderBy: { createdAt: "desc" },
          skip,
          take: limit
        }),
        prisma.newsletterSubscriber.count({ where })
      ]);

      res.json({
        data: subscribers,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          error: "Validation error",
          message: "Invalid query parameters",
          details: err.errors.map((e) => ({
            path: e.path.join("."),
            message: e.message
          }))
        });
      }
      next(err);
    }
  });

  // ==================== CONTENT MANAGEMENT ====================

  // GET /api/admin/content - pobierz wszystkie treści lub filtruj po stronie
  router.get("/content", async (req, res, next) => {
    try {
      const querySchema = z.object({
        page: z.enum(["HOME", "DREAM_POINTS", "COOPERATION"]).optional()
      });
      const query = querySchema.parse(req.query);

      const where = query.page ? { page: query.page as ContentPage } : {};

      const contents = await prisma.content.findMany({
        where,
        orderBy: [{ page: "asc" }, { section: "asc" }]
      });

      res.json({ data: contents });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          error: "Validation error",
          details: err.errors
        });
      }
      next(err);
    }
  });

  // GET /api/admin/content/:section - pobierz konkretną sekcję
  router.get("/content/:section", async (req, res, next) => {
    try {
      const { section } = req.params;

      const content = await prisma.content.findUnique({
        where: { section: section as ContentSection }
      });

      if (!content) {
        throw new NotFoundError("Content section");
      }

      res.json({ data: content });
    } catch (err) {
      next(err);
    }
  });

  // PUT /api/admin/content/:section - aktualizuj lub utwórz treść
  router.put("/content/:section", async (req, res, next) => {
    try {
      const { section } = req.params;
      const bodySchema = z.object({
        page: z.nativeEnum(ContentPage),
        data: z.any() // JSON - elastyczna struktura
      });

      const body = bodySchema.parse(req.body);

      const content = await prisma.content.upsert({
        where: { section: section as ContentSection },
        update: {
          page: body.page,
          data: body.data
        },
        create: {
          page: body.page,
          section: section as ContentSection,
          data: body.data
        }
      });
      res.json({ data: content });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          error: "Validation error",
          details: err.errors
        });
      }
      next(err);
    }
  });

  // POST /api/admin/content/COOP_GALLERY/images - dodaj zdjęcie do galerii
  router.post("/content/COOP_GALLERY/images", uploadSingleImage, async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          error: "Bad Request",
          message: "Brak pliku do uploadu",
          code: "MISSING_FILE"
        });
      }

      // Try to detect image kind from MIME type or filename
      let expectedKind = ALLOWED_IMAGE_MIME[req.file.mimetype];

      // If MIME type is not recognized, try to detect from filename extension
      if (!expectedKind) {
        const fileExt = req.file.filename.toLowerCase().split(".").pop();
        const extToKind: Record<string, "jpeg" | "png" | "webp" | "gif"> = {
          jpg: "jpeg",
          jpeg: "jpeg",
          png: "png",
          webp: "webp",
          gif: "gif"
        };
        expectedKind = extToKind[fileExt || ""];
      }

      const absPath = resolve(tripsUploadDir, req.file.filename);

      console.log(
        `[admin] Gallery image upload: mimetype=${req.file.mimetype}, originalname=${req.file.originalname}, filename=${req.file.filename}, expectedKind=${expectedKind}`
      );
      console.log(`[admin] Upload directory: ${tripsUploadDir}`);
      console.log(`[admin] Absolute path: ${absPath}`);
      console.log(`[admin] File exists: ${existsSync(absPath)}`);

      if (!expectedKind) {
        console.error(
          `[admin] Unsupported file type: mimetype=${req.file.mimetype}, originalname=${req.file.originalname}, filename=${req.file.filename}`
        );
        try {
          if (existsSync(absPath)) {
            unlinkSync(absPath);
          }
        } catch {}
        return res.status(400).json({
          error: "ValidationError",
          message: `Nieobsługiwany typ pliku: ${req.file.mimetype || "nieznany"}. Dozwolone: JPG/PNG/WEBP/GIF.`,
          code: "INVALID_IMAGE"
        });
      }

      // Wait a bit to ensure file is fully written to disk
      await new Promise((resolve) => setTimeout(resolve, 100));

      if (!existsSync(absPath)) {
        console.error(`[admin] File does not exist after upload: ${absPath}`);
        return res.status(500).json({
          error: "InternalError",
          message: "Plik nie został zapisany na serwerze.",
          code: "FILE_NOT_SAVED"
        });
      }

      // Verify image - accept if it's a valid image type, even if it doesn't match expected MIME type
      const detectedKind = verifyUploadedImage(absPath);
      if (!detectedKind) {
        console.error(`[admin] Image verification failed: file=${absPath} is not a valid image`);
        try {
          if (existsSync(absPath)) {
            unlinkSync(absPath);
          }
        } catch {}
        return res.status(400).json({
          error: "ValidationError",
          message:
            "Plik nie jest poprawnym obrazem (JPG/PNG/WEBP/GIF). Sprawdź czy plik nie jest uszkodzony.",
          code: "INVALID_IMAGE"
        });
      }

      // Log if detected type doesn't match expected type (but still accept it)
      if (detectedKind !== expectedKind) {
        console.warn(
          `[admin] Image type mismatch: expected=${expectedKind} (from MIME type), detected=${detectedKind} (from file header). File will be accepted.`
        );
      }

      const imagePath = `/assets/trips/${req.file.filename}`;

      // Pobierz aktualną zawartość COOP_GALLERY
      const galleryContent = await prisma.content.findUnique({
        where: { section: ContentSection.COOP_GALLERY }
      });

      const currentData = (galleryContent?.data as any) || {};
      const currentImages = Array.isArray(currentData.images) ? currentData.images : [];

      // Dodaj nowe zdjęcie
      const updatedImages = [...currentImages, imagePath];

      // Zaktualizuj content
      await prisma.content.upsert({
        where: { section: ContentSection.COOP_GALLERY },
        update: {
          data: {
            ...currentData,
            images: updatedImages
          }
        },
        create: {
          page: ContentPage.COOPERATION,
          section: ContentSection.COOP_GALLERY,
          data: {
            title: currentData.title || "",
            subtitle: currentData.subtitle || "",
            images: updatedImages
          }
        }
      });

      res.json({
        success: true,
        path: imagePath,
        filename: req.file.filename
      });
    } catch (err) {
      next(err);
    }
  });

  // DELETE /api/admin/content/COOP_GALLERY/images - usuń zdjęcie z galerii
  router.delete("/content/COOP_GALLERY/images", async (req, res, next) => {
    try {
      const bodySchema = z.object({
        imagePath: z.string().min(1)
      });
      const body = bodySchema.parse(req.body);

      // Pobierz aktualną zawartość COOP_GALLERY
      const galleryContent = await prisma.content.findUnique({
        where: { section: ContentSection.COOP_GALLERY }
      });

      if (!galleryContent) {
        throw new NotFoundError("COOP_GALLERY content");
      }

      const currentData = (galleryContent.data as any) || {};
      const currentImages = Array.isArray(currentData.images) ? currentData.images : [];

      // Usuń zdjęcie z listy
      const updatedImages = currentImages.filter((img: string) => img !== body.imagePath);

      // Usuń plik z dysku
      const filename = body.imagePath.split("/").pop();
      if (filename && isSafeUploadFilename(filename)) {
        try {
          const filePath = resolveUploadFilePath(filename);
          if (existsSync(filePath)) {
            unlinkSync(filePath);
            console.log(`[admin] Deleted gallery image: ${filePath}`);
          }
        } catch (fileErr) {
          console.error(`[admin] Failed to delete gallery image file:`, fileErr);
          // Kontynuuj nawet jeśli usunięcie pliku się nie powiodło
        }
      }

      // Zaktualizuj content
      await prisma.content.update({
        where: { section: ContentSection.COOP_GALLERY },
        data: {
          data: {
            ...currentData,
            images: updatedImages
          }
        }
      });

      res.json({ success: true });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          error: "Validation error",
          details: err.errors
        });
      }
      next(err);
    }
  });

  return router;
}
