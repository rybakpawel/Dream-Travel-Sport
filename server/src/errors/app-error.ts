/**
 * Bazowa klasa dla wszystkich błędów aplikacji
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly code?: string;
  public readonly details?: unknown;

  constructor(
    message: string,
    statusCode: number = 500,
    isOperational: boolean = true,
    code?: string,
    details?: unknown
  ) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.code = code;
    this.details = details;

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Błąd walidacji (400)
 */
export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 400, true, "VALIDATION_ERROR", details);
  }
}

/**
 * Błąd autoryzacji (401)
 */
export class UnauthorizedError extends AppError {
  constructor(message: string = "Unauthorized", details?: unknown) {
    super(message, 401, true, "UNAUTHORIZED", details);
  }
}

/**
 * Błąd zabronionego dostępu (403)
 */
export class ForbiddenError extends AppError {
  constructor(message: string = "Forbidden", details?: unknown) {
    super(message, 403, true, "FORBIDDEN", details);
  }
}

/**
 * Błąd nie znaleziono zasobu (404)
 */
export class NotFoundError extends AppError {
  constructor(resource: string = "Resource", details?: unknown) {
    super(`${resource} not found`, 404, true, "NOT_FOUND", details);
  }
}

/**
 * Błąd konfliktu (409)
 */
export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 409, true, "CONFLICT", details);
  }
}

/**
 * Błąd nieobsługiwany (422)
 */
export class UnprocessableEntityError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 422, true, "UNPROCESSABLE_ENTITY", details);
  }
}

/**
 * Błąd serwisu niedostępnego (503)
 */
export class ServiceUnavailableError extends AppError {
  constructor(message: string = "Service unavailable", details?: unknown) {
    super(message, 503, true, "SERVICE_UNAVAILABLE", details);
  }
}

