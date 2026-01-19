import express from "express";

import type { Env } from "../env.js";
import { prisma } from "../prisma.js";
import type { EmailService } from "../services/email.js";
import { createP24Client } from "../services/p24.js";

type HealthStatus = "healthy" | "degraded" | "unhealthy";

type HealthCheckResult = {
  status: HealthStatus;
  message?: string;
  latency?: number;
  error?: string;
};

type HealthResponse = {
  status: HealthStatus;
  timestamp: string;
  uptime: number;
  version?: string;
  checks: {
    database: HealthCheckResult;
    email?: HealthCheckResult;
    payments?: HealthCheckResult;
  };
};

const startTime = Date.now();

/**
 * Sprawdza połączenie z bazą danych
 */
async function checkDatabase(): Promise<HealthCheckResult> {
  const start = Date.now();
  try {
    // Proste zapytanie do bazy (SELECT 1)
    await prisma.$queryRaw`SELECT 1`;
    const latency = Date.now() - start;

    return {
      status: "healthy",
      latency,
      message: "Database connection OK"
    };
  } catch (err) {
    const latency = Date.now() - start;
    return {
      status: "unhealthy",
      latency,
      error: err instanceof Error ? err.message : "Unknown database error",
      message: "Database connection failed"
    };
  }
}

/**
 * Sprawdza dostępność serwisu email (Resend lub SMTP w zależności od EMAIL_PROVIDER)
 */
async function checkEmail(emailService: EmailService | null): Promise<HealthCheckResult> {
  if (!emailService) {
    return {
      status: "degraded",
      message: "Email service not configured"
    };
  }

  // Email service nie ma bezpośredniego health check API
  // Więc sprawdzamy tylko czy jest skonfigurowany
  // W produkcji można dodać test wysyłki do sandbox
  return {
    status: "healthy",
    message: "Email service configured"
  };
}

/**
 * Sprawdza dostępność serwisu płatności (P24)
 */
async function checkPayments(env: Env): Promise<HealthCheckResult> {
  const hasP24Key = Boolean(env.P24_REPORT_KEY || env.P24_RAPORT_KEY || env.P24_API_KEY);
  if (!env.P24_POS_ID || !hasP24Key) {
    return {
      status: "degraded",
      message: "Payment service not configured"
    };
  }

  // P24 nie ma dedykowanego health check endpoint
  // Sprawdzamy tylko konfigurację
  // W produkcji można dodać testowe zapytanie do API
  try {
    const p24Client = createP24Client(env);
    // Sprawdzamy tylko czy klient może być utworzony
    // (nie wykonujemy rzeczywistego zapytania, bo to kosztowne)
    return {
      status: "healthy",
      message: "Payment service configured"
    };
  } catch (err) {
    return {
      status: "unhealthy",
      error: err instanceof Error ? err.message : "Unknown payment service error",
      message: "Payment service configuration error"
    };
  }
}

/**
 * Oblicza ogólny status na podstawie wyników poszczególnych checków
 */
function calculateOverallStatus(checks: HealthResponse["checks"]): HealthStatus {
  const statuses = Object.values(checks).map((check) => check.status);

  if (statuses.some((s) => s === "unhealthy")) {
    return "unhealthy";
  }

  if (statuses.some((s) => s === "degraded")) {
    return "degraded";
  }

  return "healthy";
}

export function createHealthRouter(env: Env, emailService: EmailService | null): express.Router {
  const router = express.Router();

  // GET /api/health - pełny health check
  router.get("/", async (_req, res) => {
    try {
      const [databaseCheck, emailCheck, paymentsCheck] = await Promise.all([
        checkDatabase(),
        checkEmail(emailService),
        checkPayments(env)
      ]);

      const checks = {
        database: databaseCheck,
        email: emailCheck,
        payments: paymentsCheck
      };

      const overallStatus = calculateOverallStatus(checks);

      const response: HealthResponse = {
        status: overallStatus,
        timestamp: new Date().toISOString(),
        uptime: Math.floor((Date.now() - startTime) / 1000), // w sekundach
        checks
      };

      // Zwróć odpowiedni status HTTP
      const statusCode = overallStatus === "healthy" ? 200 : overallStatus === "degraded" ? 200 : 503;

      res.status(statusCode).json(response);
    } catch (err) {
      res.status(503).json({
        status: "unhealthy" as HealthStatus,
        timestamp: new Date().toISOString(),
        uptime: Math.floor((Date.now() - startTime) / 1000),
        error: err instanceof Error ? err.message : "Unknown error",
        checks: {
          database: { status: "unhealthy" as HealthStatus, error: "Health check failed" }
        }
      });
    }
  });

  // GET /api/health/live - liveness probe (czy aplikacja działa)
  router.get("/live", (_req, res) => {
    res.json({
      status: "alive",
      timestamp: new Date().toISOString()
    });
  });

  // GET /api/health/ready - readiness probe (czy aplikacja jest gotowa do przyjmowania requestów)
  router.get("/ready", async (_req, res) => {
    try {
      // Sprawdź tylko krytyczne zależności (baza danych)
      const databaseCheck = await checkDatabase();

      if (databaseCheck.status === "unhealthy") {
        return res.status(503).json({
          status: "not ready",
          timestamp: new Date().toISOString(),
          reason: "Database connection failed",
          check: databaseCheck
        });
      }

      res.json({
        status: "ready",
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      res.status(503).json({
        status: "not ready",
        timestamp: new Date().toISOString(),
        error: err instanceof Error ? err.message : "Unknown error"
      });
    }
  });

  return router;
}

