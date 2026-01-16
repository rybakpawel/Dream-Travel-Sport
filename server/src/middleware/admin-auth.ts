import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

import { UnauthorizedError } from "../errors/app-error.js";
import type { Env } from "../env.js";

/**
 * Middleware do autentykacji admina
 * Sprawdza JWT w HttpOnly cookie
 */
export function createAdminAuthMiddleware(env: Env) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Pobierz token z cookie
    const token = req.cookies?.adminToken;

    if (!token) {
      throw new UnauthorizedError("Missing admin token cookie");
    }

    if (!env.ADMIN_TOKEN || env.ADMIN_TOKEN.length < 32) {
      throw new UnauthorizedError("Admin token not configured");
    }

    try {
      // Zweryfikuj JWT
      const decoded = jwt.verify(token, env.ADMIN_TOKEN) as { admin?: boolean };

      if (!decoded.admin) {
        throw new UnauthorizedError("Invalid token payload");
      }

      // Token jest poprawny - kontynuuj
      next();
    } catch (err) {
      if (err instanceof jwt.JsonWebTokenError || err instanceof jwt.TokenExpiredError) {
        throw new UnauthorizedError("Invalid or expired token");
      }
      throw err;
    }
  };
}

