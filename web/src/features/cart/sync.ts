/**
 * Synchronizacja koszyka z backendem
 */

import { cartApi } from "../../api/client.js";
import type { Cart } from "./types.js";
import { loadCart, saveCart } from "./storage.js";

/**
 * Synchronizuje koszyk z backendem (jeśli istnieje aktywna sesja checkoutu)
 * @param isMagicLink - jeśli true, koszyk magic linku jest izolowany (nie synchronizuje z localStorage)
 */
export async function syncCartWithBackend(sessionId: string | null, isMagicLink: boolean = false): Promise<Cart> {
  if (!sessionId) {
    // Brak sesji - użyj localStorage TYLKO jeśli nie jest magic link
    return isMagicLink ? [] : loadCart();
  }

  try {
    // Pobierz koszyk z backendu
    const response = await cartApi.getCart(sessionId);
    const backendCart = response.cart || [];

    // Jeśli magic link, nie synchronizuj z localStorage (izolacja)
    if (isMagicLink) {
      return backendCart;
    }

    // Normalna synchronizacja dla zwykłego checkoutu
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
        // Sprawdź czy błąd wynika z tego, że sesja jest PAID
        const errorMessage = err instanceof Error ? err.message : String(err);
        if (errorMessage.includes("PAID") || errorMessage.includes("zakończona")) {
          // Sesja jest PAID - nie można jej modyfikować, ale użytkownik może komponować nowe zamówienie
          // Zwróć lokalny koszyk (nie czyść go) - nowa sesja zostanie utworzona przy składaniu zamówienia
          // Sesja zostanie usunięta w ensureCheckoutSessionForEmail gdy wykryje PAID status
          return localCart;
        }
        console.warn("Failed to sync cart to backend, using local cart:", err);
        return localCart;
      }
    }

    return [];
  } catch (err) {
    // Sprawdź czy błąd wynika z tego, że sesja jest PAID lub nie istnieje
    const errorMessage = err instanceof Error ? err.message : String(err);
    if (errorMessage.includes("PAID") || errorMessage.includes("zakończona")) {
      // Sesja jest PAID - nie można jej modyfikować, ale użytkownik może komponować nowe zamówienie
      // Zwróć lokalny koszyk (nie czyść go) TYLKO jeśli nie jest magic link
      // Nowa sesja zostanie utworzona przy składaniu zamówienia
      return isMagicLink ? [] : loadCart();
    }
    console.warn("Failed to sync cart with backend, using local cart:", err);
    // W przypadku błędu, użyj localStorage TYLKO jeśli nie jest magic link
    return isMagicLink ? [] : loadCart();
  }
}

/**
 * Zapisuje koszyk do backendu (jeśli istnieje aktywna sesja checkoutu)
 * @param isMagicLink - jeśli true, koszyk magic linku jest izolowany (nie zapisuje do localStorage)
 */
export async function saveCartToBackend(
  cart: Cart,
  sessionId: string | null,
  isMagicLink: boolean = false
): Promise<void> {
  // Zapisz do localStorage TYLKO jeśli nie jest magic link (izolacja)
  if (!isMagicLink) {
    saveCart(cart);
  }

  if (!sessionId) {
    // Brak sesji - tylko localStorage (jeśli nie magic link)
    return;
  }

  try {
    // Zsynchronizuj z backendem
    await cartApi.updateCart(sessionId, cart);
  } catch (err) {
    // Sprawdź czy błąd wynika z tego, że sesja jest PAID
    const errorMessage = err instanceof Error ? err.message : String(err);
    if (errorMessage.includes("PAID") || errorMessage.includes("zakończona")) {
      // Sesja jest PAID - nie można jej modyfikować
      // Rzuć błąd, żeby frontend mógł go obsłużyć (wyczyścić sesję, pokazać komunikat)
      throw new Error("Session is PAID - cannot modify cart");
    }
    console.warn("Failed to save cart to backend:", err);
    // Nie rzucaj błędu - localStorage jest zapisany (jeśli nie magic link), więc koszyk nie jest stracony
  }
}

/**
 * Pobiera koszyk z backendu (jeśli istnieje aktywna sesja checkoutu)
 * @param isMagicLink - jeśli true, koszyk magic linku jest izolowany (nie synchronizuje z localStorage)
 */
export async function loadCartFromBackend(sessionId: string | null, isMagicLink: boolean = false): Promise<Cart> {
  if (!sessionId) {
    // Brak sesji - użyj localStorage TYLKO jeśli nie jest magic link
    return isMagicLink ? [] : loadCart();
  }

  try {
    const response = await cartApi.getCart(sessionId);
    const backendCart = response.cart || [];

    // Zsynchronizuj localStorage z backendem TYLKO jeśli nie jest magic link
    if (!isMagicLink && backendCart.length > 0) {
      saveCart(backendCart);
    }

    return backendCart;
  } catch (err) {
    console.warn("Failed to load cart from backend, using local cart:", err);
    // W przypadku błędu, użyj localStorage TYLKO jeśli nie jest magic link
    return isMagicLink ? [] : loadCart();
  }
}

