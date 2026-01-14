/**
 * Synchronizacja koszyka z backendem
 */

import { cartApi } from "../../api/client.js";
import type { Cart } from "./types.js";
import { loadCart, saveCart } from "./storage.js";

/**
 * Synchronizuje koszyk z backendem (jeśli istnieje aktywna sesja checkoutu)
 */
export async function syncCartWithBackend(sessionId: string | null): Promise<Cart> {
  if (!sessionId) {
    // Brak sesji - użyj localStorage
    return loadCart();
  }

  try {
    // Pobierz koszyk z backendu
    const response = await cartApi.getCart(sessionId);
    const backendCart = response.cart || [];

    // Pobierz koszyk z localStorage
    const localCart = loadCart();

    // Jeśli backend ma koszyk, użyj go (jest źródłem prawdy)
    if (backendCart.length > 0) {
      // Zsynchronizuj localStorage z backendem
      saveCart(backendCart);
      return backendCart;
    }

    // Jeśli backend nie ma koszyka, ale localStorage ma - zsynchronizuj z backendem
    if (localCart.length > 0) {
      try {
        await cartApi.updateCart(sessionId, localCart);
        return localCart;
      } catch (err) {
        console.warn("Failed to sync cart to backend, using local cart:", err);
        return localCart;
      }
    }

    return [];
  } catch (err) {
    console.warn("Failed to sync cart with backend, using local cart:", err);
    // W przypadku błędu, użyj localStorage
    return loadCart();
  }
}

/**
 * Zapisuje koszyk do backendu (jeśli istnieje aktywna sesja checkoutu)
 */
export async function saveCartToBackend(
  cart: Cart,
  sessionId: string | null
): Promise<void> {
  // Zawsze zapisz do localStorage (fallback)
  saveCart(cart);

  if (!sessionId) {
    // Brak sesji - tylko localStorage
    return;
  }

  try {
    // Zsynchronizuj z backendem
    await cartApi.updateCart(sessionId, cart);
  } catch (err) {
    console.warn("Failed to save cart to backend:", err);
    // Nie rzucaj błędu - localStorage jest zapisany, więc koszyk nie jest stracony
  }
}

/**
 * Pobiera koszyk z backendu (jeśli istnieje aktywna sesja checkoutu)
 */
export async function loadCartFromBackend(sessionId: string | null): Promise<Cart> {
  if (!sessionId) {
    // Brak sesji - użyj localStorage
    return loadCart();
  }

  try {
    const response = await cartApi.getCart(sessionId);
    const backendCart = response.cart || [];

    // Zsynchronizuj localStorage z backendem
    if (backendCart.length > 0) {
      saveCart(backendCart);
    }

    return backendCart;
  } catch (err) {
    console.warn("Failed to load cart from backend, using local cart:", err);
    // W przypadku błędu, użyj localStorage
    return loadCart();
  }
}

