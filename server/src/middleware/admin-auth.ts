import { Request, Response, NextFunction } from "express";

import { UnauthorizedError } from "../errors/app-error.js";
import type { Env } from "../env.js";

/**
 * Middleware do autentykacji admina
 * Sprawdza token w nagłówku Authorization: Bearer <token>
 */
export function createAdminAuthMiddleware(env: Env) {
  return (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new UnauthorizedError("Missing or invalid authorization header");
    }

    const token = authHeader.substring(7); // Usuń "Bearer "

    if (!env.ADMIN_TOKEN || env.ADMIN_TOKEN.length < 32) {
      throw new UnauthorizedError("Admin token not configured");
    }

    if (token !== env.ADMIN_TOKEN) {
      throw new UnauthorizedError("Invalid admin token");
    }

    // Token jest poprawny - kontynuuj
    next();
  };
}

