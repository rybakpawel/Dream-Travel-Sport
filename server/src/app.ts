import cors from "cors";
import express from "express";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Env } from "./env.js";
import { createAdminRouter } from "./routes/admin.js";
import { createCartRouter } from "./routes/cart.js";
import { createCheckoutRouter } from "./routes/checkout.js";
import { createHealthRouter } from "./routes/health.js";
import { createNewsletterRouter } from "./routes/newsletter.js";
import { createOrdersRouter } from "./routes/orders.js";
import { createPaymentsRouter } from "./routes/payments.js";
import { errorHandler } from "./middleware/error-handler.js";
import { createEmailService } from "./services/email.js";
import { tripsRouter } from "./routes/trips.js";
import { contentRouter } from "./routes/content.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function parseCorsOrigins(value: string): string[] {
  return value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

export function createApp(env: Env) {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  // Serwuj statyczne pliki z web/public (obrazy, itp.)
  const publicDir = join(__dirname, "../../web/public");
  app.use("/assets", express.static(publicDir));

  // Trust proxy dla poprawnego wykrywania IP (ważne dla rate limiting i webhooków)
  app.set("trust proxy", 1);

  app.use(
    cors({
      origin: parseCorsOrigins(env.CORS_ORIGIN),
      credentials: true
    })
  );

  const emailService = createEmailService(env);

  // Health checks (przed innymi routerami, żeby były dostępne nawet przy problemach)
  app.use("/api/health", createHealthRouter(env, emailService));

  // Admin dashboard (wymaga autentykacji)
  app.use("/api/admin", createAdminRouter(env, emailService));

  app.use("/api/trips", tripsRouter);
  app.use("/api/content", contentRouter);
  app.use("/api/newsletter", createNewsletterRouter(env, emailService));
  app.use("/api/cart", createCartRouter(env));
  app.use("/api/checkout", createCheckoutRouter(env, emailService));
  app.use("/api/orders", createOrdersRouter(env, emailService));
  app.use("/api", createPaymentsRouter(env, emailService));

  app.use((_req, res) => {
    res.status(404).json({ error: "Not found", message: "Resource not found", code: "NOT_FOUND" });
  });

  // Error handling middleware (musi być na końcu, po wszystkich routerach)
  app.use(errorHandler);

  return app;
}
