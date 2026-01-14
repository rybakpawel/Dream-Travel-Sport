import express from "express";
import { ZodError } from "zod";

import { AppError } from "../errors/app-error.js";

type ErrorResponse = {
  error: string;
  message: string;
  code?: string;
  details?: unknown;
  // W development pokazujemy stack trace
  stack?: string;
};

/**
 * Formatuje błąd Zod na czytelny format
 */
function formatZodError(error: ZodError): { message: string; details: unknown } {
  const issues = error.issues.map((issue) => {
    const path = issue.path.join(".");
    return {
      field: path || "root",
      message: issue.message,
      code: issue.code
    };
  });

  return {
    message: "Validation error",
    details: issues
  };
}

/**
 * Formatuje błąd Prisma na czytelny format
 */
function formatPrismaError(error: Error): { message: string; code?: string; details?: unknown } {
  // Prisma error codes
  if (error.message.includes("Unique constraint")) {
    return {
      message: "Resource already exists",
      code: "UNIQUE_CONSTRAINT_VIOLATION",
      details: { message: error.message }
    };
  }

  if (error.message.includes("Foreign key constraint")) {
    return {
      message: "Invalid reference",
      code: "FOREIGN_KEY_CONSTRAINT_VIOLATION",
      details: { message: error.message }
    };
  }

  if (error.message.includes("Record to update not found")) {
    return {
      message: "Resource not found",
      code: "NOT_FOUND"
    };
  }

  return {
    message: "Database error",
    code: "DATABASE_ERROR",
    details: { message: error.message }
  };
}

/**
 * Error handling middleware dla Express
 */
export function errorHandler(
  err: unknown,
  req: express.Request,
  res: express.Response,
  _next: express.NextFunction
) {
  let statusCode = 500;
  let errorResponse: ErrorResponse;

  // AppError - nasze custom błędy
  if (err instanceof AppError) {
    statusCode = err.statusCode;
    errorResponse = {
      error: err.name,
      message: err.message,
      code: err.code,
      details: err.details
    };

    // W development dodaj stack trace
    if (process.env.NODE_ENV === "development") {
      errorResponse.stack = err.stack;
    }

    // Logowanie błędów operacyjnych (nie logujemy wszystkich błędów)
    if (!err.isOperational) {
      console.error("[ERROR]", {
        name: err.name,
        message: err.message,
        code: err.code,
        statusCode: err.statusCode,
        stack: err.stack,
        path: req.path,
        method: req.method
      });
    } else {
      // Logowanie błędów operacyjnych na poziomie info/warn
      const logLevel = statusCode >= 500 ? "error" : statusCode >= 400 ? "warn" : "info";
      console[logLevel]("[ERROR]", {
        name: err.name,
        message: err.message,
        code: err.code,
        statusCode: err.statusCode,
        path: req.path,
        method: req.method
      });
    }
  }
  // ZodError - błędy walidacji
  else if (err instanceof ZodError) {
    statusCode = 400;
    const formatted = formatZodError(err);
    errorResponse = {
      error: "ValidationError",
      message: formatted.message,
      code: "VALIDATION_ERROR",
      details: formatted.details
    };

    console.warn("[VALIDATION_ERROR]", {
      path: req.path,
      method: req.method,
      details: formatted.details
    });
  }
  // Prisma errors
  else if (err instanceof Error && err.name === "PrismaClientKnownRequestError") {
    statusCode = 400;
    const formatted = formatPrismaError(err);
    errorResponse = {
      error: "DatabaseError",
      message: formatted.message,
      code: formatted.code,
      details: formatted.details
    };

    console.error("[DATABASE_ERROR]", {
      name: err.name,
      message: err.message,
      code: formatted.code,
      path: req.path,
      method: req.method,
      stack: err.stack
    });
  }
  // Inne błędy Prisma
  else if (err instanceof Error && err.name.startsWith("Prisma")) {
    statusCode = 500;
    errorResponse = {
      error: "DatabaseError",
      message: "Database operation failed",
      code: "DATABASE_ERROR"
    };

    console.error("[DATABASE_ERROR]", {
      name: err.name,
      message: err.message,
      path: req.path,
      method: req.method,
      stack: err.stack
    });
  }
  // Nieznane błędy
  else {
    statusCode = 500;
    errorResponse = {
      error: "InternalServerError",
      message: process.env.NODE_ENV === "production" ? "Internal server error" : String(err),
      code: "INTERNAL_SERVER_ERROR"
    };

    // W development pokazujemy więcej szczegółów
    if (process.env.NODE_ENV === "development" && err instanceof Error) {
      errorResponse.stack = err.stack;
    }

    // Logowanie nieznanych błędów
    console.error("[UNKNOWN_ERROR]", {
      error: err,
      path: req.path,
      method: req.method,
      stack: err instanceof Error ? err.stack : undefined
    });
  }

  res.status(statusCode).json(errorResponse);
}

