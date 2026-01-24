import { checkoutApi } from "../../api/client.js";
import type { Cart } from "../cart/types.js";

let currentSessionId: string | null = null;
let currentMagicLinkSessionId: string | null = null;
const CHECKOUT_SESSION_KEY = "checkoutSessionId";
const MAGIC_LINK_SESSION_KEY = "checkoutSessionIdMagicLink";

export async function createCheckoutSession(
  customerEmail: string,
  cartData: Cart
): Promise<string> {
  try {
    const response = await checkoutApi.createSession({
      customerEmail,
      cartData
    });
    setCurrentSessionId(response.session.id, false);
    return response.session.id;
  } catch (err) {
    console.error("Failed to create checkout session:", err);
    throw err;
  }
}

export function getCurrentSessionId(isMagicLink: boolean = false): string | null {
  if (isMagicLink) {
    if (currentMagicLinkSessionId) return currentMagicLinkSessionId;
    const stored = localStorage.getItem(MAGIC_LINK_SESSION_KEY);
    if (stored) {
      currentMagicLinkSessionId = stored;
      return stored;
    }
    return currentMagicLinkSessionId;
  }
  
  if (currentSessionId) return currentSessionId;
  const stored = localStorage.getItem(CHECKOUT_SESSION_KEY);
  if (stored) {
    currentSessionId = stored;
    return stored;
  }
  return currentSessionId;
}

export function setCurrentSessionId(sessionId: string | null, isMagicLink: boolean = false): void {
  if (isMagicLink) {
    currentMagicLinkSessionId = sessionId;
    if (sessionId) {
      localStorage.setItem(MAGIC_LINK_SESSION_KEY, sessionId);
    } else {
      localStorage.removeItem(MAGIC_LINK_SESSION_KEY);
    }
  } else {
    currentSessionId = sessionId;
    if (sessionId) {
      localStorage.setItem(CHECKOUT_SESSION_KEY, sessionId);
    } else {
      localStorage.removeItem(CHECKOUT_SESSION_KEY);
    }
  }
}

export async function getCheckoutSession(sessionId: string) {
  return checkoutApi.getSession(sessionId);
}

