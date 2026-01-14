import { checkoutApi } from "../../api/client.js";
import type { Cart } from "../cart/types.js";

let currentSessionId: string | null = null;
const CHECKOUT_SESSION_KEY = "checkoutSessionId";

export async function createCheckoutSession(
  customerEmail: string,
  cartData: Cart
): Promise<string> {
  try {
    const response = await checkoutApi.createSession({
      customerEmail,
      cartData
    });
    setCurrentSessionId(response.session.id);
    return response.session.id;
  } catch (err) {
    console.error("Failed to create checkout session:", err);
    throw err;
  }
}

export function getCurrentSessionId(): string | null {
  if (currentSessionId) return currentSessionId;
  const stored = localStorage.getItem(CHECKOUT_SESSION_KEY);
  if (stored) {
    currentSessionId = stored;
    return stored;
  }
  return currentSessionId;
}

export function setCurrentSessionId(sessionId: string | null): void {
  currentSessionId = sessionId;
  if (sessionId) {
    localStorage.setItem(CHECKOUT_SESSION_KEY, sessionId);
  } else {
    localStorage.removeItem(CHECKOUT_SESSION_KEY);
  }
}

export async function getCheckoutSession(sessionId: string) {
  return checkoutApi.getSession(sessionId);
}

