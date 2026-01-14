/**
 * Walidacja i obsługa edge case'ów checkoutu
 */

import { checkoutApi } from "../../api/client.js";
import { notifications } from "../../utils/notifications.js";

export type SessionStatus = "PENDING" | "PAID" | "EXPIRED" | "CANCELLED";

export interface SessionValidationResult {
  isValid: boolean;
  status?: SessionStatus;
  message?: string;
  shouldBlock?: boolean;
}

/**
 * Waliduje status sesji checkoutu przed akcją
 */
export async function validateSessionBeforeAction(
  sessionId: string,
  action: string = "akcję"
): Promise<SessionValidationResult> {
  try {
    const response = await checkoutApi.getSession(sessionId);
    const status = response.session.status as SessionStatus;

    // Sesja nie jest w stanie PENDING - zablokuj akcję
    if (status !== "PENDING") {
      let message = "";
      let shouldBlock = true;

      switch (status) {
        case "PAID":
          message =
            "Ta sesja checkoutu została już zakończona (zamówienie zostało utworzone). Nie można wykonać tej akcji.";
          break;
        case "EXPIRED":
          message = "Sesja checkoutu wygasła. Proszę rozpocząć nowy checkout.";
          break;
        case "CANCELLED":
          message = "Sesja checkoutu została anulowana. Proszę rozpocząć nowy checkout.";
          break;
        default:
          message = `Sesja checkoutu nie jest w stanie umożliwiającym wykonanie ${action}.`;
      }

      return {
        isValid: false,
        status,
        message,
        shouldBlock
      };
    }

    // Sprawdź czy sesja nie wygasła (backup check)
    if (response.session.expiresAt) {
      const expiresAt = new Date(response.session.expiresAt);
      if (expiresAt < new Date()) {
        return {
          isValid: false,
          status: "EXPIRED",
          message: "Sesja checkoutu wygasła. Proszę rozpocząć nowy checkout.",
          shouldBlock: true
        };
      }
    }

    return {
      isValid: true,
      status: "PENDING"
    };
  } catch (err) {
    console.error("Failed to validate session:", err);
    // Jeśli nie udało się pobrać sesji, zablokuj akcję
    return {
      isValid: false,
      message: "Nie udało się zweryfikować sesji checkoutu. Spróbuj odświeżyć stronę.",
      shouldBlock: true
    };
  }
}

/**
 * Sprawdza i obsługuje sytuację gdy sesja nie jest już aktywna
 */
export async function handleInvalidSession(
  sessionId: string,
  action: string = "akcję"
): Promise<boolean> {
  const validation = await validateSessionBeforeAction(sessionId, action);

  if (!validation.isValid && validation.shouldBlock) {
    notifications.error(validation.message || "Nie można wykonać tej akcji.");

    // Jeśli sesja jest zakończona, wyczyść ją lokalnie i pozwól rozpocząć nowy checkout
    if (validation.status === "PAID") {
      localStorage.removeItem("checkoutSessionId");
      return false;
    }

    // Jeśli sesja wygasła lub została anulowana, wyczyść sesję i pozwól użytkownikowi rozpocząć nowy checkout
    if (validation.status === "EXPIRED" || validation.status === "CANCELLED") {
      // Wyczyść sesję z localStorage
      localStorage.removeItem("checkoutSessionId");
      return false;
    }

    return false;
  }

  return validation.isValid;
}

/**
 * Sprawdza czy sesja jest nadal aktywna (dla wielu kart)
 */
export async function checkSessionStillActive(sessionId: string): Promise<boolean> {
  try {
    const response = await checkoutApi.getSession(sessionId);
    return response.session.status === "PENDING";
  } catch {
    return false;
  }
}

/**
 * Obsługuje sytuację gdy użytkownik ma wiele kart z tym samym checkoutem
 */
export async function handleMultipleTabs(sessionId: string): Promise<void> {
  // Sprawdź status sesji
  const isActive = await checkSessionStillActive(sessionId);

  if (!isActive) {
    // Sesja nie jest już aktywna - pokaż komunikat
    const validation = await validateSessionBeforeAction(sessionId);
    if (validation.message) {
      notifications.warning(validation.message);
    }

    // Jeśli sesja została opłacona, przekieruj
    if (validation.status === "PAID") {
      setTimeout(() => {
        window.location.href = "index.html";
      }, 3000);
    }
  }
}

/**
 * Sprawdza czy token magic link jest nadal ważny
 */
export function validateMagicLinkToken(token: string | null): boolean {
  if (!token) {
    return false;
  }

  // Token powinien być w URL (z backendu)
  // Jeśli jest w localStorage, sprawdź czy nie wygasł
  // (Backend weryfikuje token, więc tutaj tylko podstawowa walidacja)
  return token.length > 0;
}

