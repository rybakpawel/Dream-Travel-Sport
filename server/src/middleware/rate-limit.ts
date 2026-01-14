import express from "express";
import rateLimit from "express-rate-limit";

import type { Env } from "../env.js";

/**
 * Rate limiter dla newslettera - 5 requestów na minutę na IP
 */
export function createNewsletterRateLimiter(env: Env) {
  return rateLimit({
    windowMs: 60 * 1000, // 1 minuta
    max: env.NODE_ENV === "production" ? 5 : 100, // 5 w produkcji, 100 w development
    message: {
      error: "Too many requests",
      message: "Zbyt wiele prób zapisu do newslettera. Spróbuj ponownie za chwilę."
    },
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false // Disable the `X-RateLimit-*` headers
  });
}

/**
 * Rate limiter dla magic linków - 3 requesty na minutę na email
 * Używa custom keyGenerator, aby limitować po emailu zamiast IP
 */
export function createMagicLinkRateLimiter(env: Env) {
  return rateLimit({
    windowMs: 60 * 1000, // 1 minuta
    max: env.NODE_ENV === "production" ? 3 : 50, // 3 w produkcji, 50 w development
    keyGenerator: (req) => {
      // Użyj email z body jako klucza (jeśli dostępny)
      const email = (req.body as { customerEmail?: string })?.customerEmail;
      return email || req.ip; // Fallback do IP jeśli email nie jest dostępny
    },
    message: {
      error: "Too many requests",
      message: "Zbyt wiele prób wygenerowania magic linku. Spróbuj ponownie za chwilę."
    },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
      // W development, pomiń rate limiting jeśli nie ma email w body
      return env.NODE_ENV === "development" && !(req.body as { customerEmail?: string })?.customerEmail;
    }
  });
}

/**
 * Rate limiter dla zamówień - 10 requestów na minutę na IP
 */
export function createOrdersRateLimiter(env: Env) {
  return rateLimit({
    windowMs: 60 * 1000, // 1 minuta
    max: env.NODE_ENV === "production" ? 10 : 100, // 10 w produkcji, 100 w development
    message: {
      error: "Too many requests",
      message: "Zbyt wiele prób utworzenia zamówienia. Spróbuj ponownie za chwilę."
    },
    standardHeaders: true,
    legacyHeaders: false
  });
}

/**
 * Middleware do weryfikacji IP dla webhooków P24
 * Sprawdza czy IP jest na whitelist (jeśli skonfigurowana)
 */
export function createP24WebhookWhitelist(env: Env) {
  const customIps = env.P24_WEBHOOK_IPS
    ? env.P24_WEBHOOK_IPS.split(",").map((ip) => ip.trim()).filter(Boolean)
    : [];

  // Whitelist jest opcjonalny. Jeśli P24_WEBHOOK_IPS nie jest ustawione, nie blokujemy webhooków
  // (autentyczność i tak jest weryfikowana przez sygnaturę + transaction/verify).
  if (customIps.length === 0) {
    if (env.NODE_ENV === "production") {
      console.warn(
        "[rate-limit] P24_WEBHOOK_IPS not configured in production - webhook IP whitelist disabled (relying on signature verification)."
      );
    } else {
      console.log("[rate-limit] P24 webhook IP whitelist disabled (P24_WEBHOOK_IPS not set)");
    }
    return (_req: express.Request, _res: express.Response, next: express.NextFunction) => {
      next();
    };
  }

  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const clientIp = req.ip || req.socket.remoteAddress || "";

    // Sprawdź czy IP jest na whitelist
    const isAllowed = customIps.some((allowedIp) => {
      // Obsługa CIDR notation (np. 192.168.1.0/24)
      if (allowedIp.includes("/")) {
        // Prosta walidacja CIDR (dla pełnej obsługi można użyć biblioteki)
        const [ip, mask] = allowedIp.split("/");
        const maskBits = parseInt(mask, 10);
        if (isNaN(maskBits) || maskBits < 0 || maskBits > 32) {
          return false;
        }
        // Dla uproszczenia, sprawdzamy tylko dokładne dopasowanie IP
        // W produkcji warto użyć biblioteki do obsługi CIDR
        return clientIp.startsWith(ip.split(".").slice(0, Math.floor(maskBits / 8)).join("."));
      }
      return clientIp === allowedIp;
    });

    if (!isAllowed) {
      console.warn(`[rate-limit] P24 webhook blocked from IP: ${clientIp}`);
      return res.status(403).json({
        error: "Forbidden",
        message: "IP address not allowed"
      });
    }

    next();
  };
}

