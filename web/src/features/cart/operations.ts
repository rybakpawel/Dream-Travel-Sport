import type { Cart } from "./types";
import { MAX_QTY_PER_TRIP } from "./storage";

function clampQty(qty: number): number {
  return Math.max(1, Math.min(MAX_QTY_PER_TRIP, Math.trunc(qty)));
}

export function addTrip(
  cart: Cart,
  id: string,
  departurePointId?: string,
  priceCents?: number
): Cart {
  // Jeśli istnieje już wyjazd z tym samym ID i miejscem wylotu, zwiększ qty
  // W przeciwnym razie, dodaj nowy element (nawet jeśli ID jest takie samo, ale miejsce wylotu różne)
  const existingIndex = cart.findIndex((item) => {
    // Porównaj ID
    if (item.id !== id) return false;
    
    // Porównaj departurePointId (oba muszą być undefined/null/empty lub oba muszą być równe)
    const itemDepPointId = item.departurePointId || undefined;
    const newDepPointId = departurePointId || undefined;
    
    // Jeśli oba są undefined, to są równe (stary format lub wyjazd bez miejsc wylotu)
    if (!itemDepPointId && !newDepPointId) return true;
    
    // Jeśli oba mają wartości, porównaj je
    if (itemDepPointId && newDepPointId) {
      return itemDepPointId === newDepPointId;
    }
    
    // Jeden ma wartość, drugi nie - traktuj jako różne (różne miejsca wylotu lub upgrade z starego do nowego formatu)
    return false;
  });

  if (existingIndex === -1) {
    // Nowy element - dodaj do koszyka
    return [...cart, { id, qty: 1, departurePointId, priceCents }];
  }

  // Istniejący element - zwiększ qty
  const existing = cart[existingIndex];
  const nextQty = Math.min(MAX_QTY_PER_TRIP, existing.qty + 1);
  const next = [...cart];
  next[existingIndex] = {
    ...existing,
    qty: nextQty,
    // Zachowaj departurePointId i priceCents jeśli są już ustawione, w przeciwnym razie użyj nowych wartości
    departurePointId: departurePointId || existing.departurePointId,
    priceCents: priceCents !== undefined ? priceCents : existing.priceCents
  };
  return next;
}

/**
 * Zmienia ilość pozycji w koszyku.
 * UWAGA: Ta funkcja nie sprawdza dostępności miejsc - walidacja dostępności
 * powinna być wykonana przed wywołaniem tej funkcji (np. w event listenerze select'a).
 * @param cart - Koszyk
 * @param index - Indeks pozycji w koszyku
 * @param qty - Nowa ilość (zostanie ograniczona do MAX_QTY_PER_TRIP)
 * @returns Nowy koszyk z zaktualizowaną ilością
 */
export function setItemQty(cart: Cart, index: number, qty: number): Cart {
  if (!Number.isFinite(index) || index < 0 || index >= cart.length) return cart;
  if (!Number.isFinite(qty)) return cart;

  const next = [...cart];
  next[index] = { ...next[index], qty: clampQty(qty) };
  return next;
}

export function removeItem(cart: Cart, index: number): Cart {
  if (!Number.isFinite(index) || index < 0 || index >= cart.length) return cart;
  const next = [...cart];
  next.splice(index, 1);
  return next;
}

/**
 * Sprawdza, czy wyjazd jest już w koszyku (uwzględnia miejsce wylotu)
 */
export function isTripInCart(
  cart: Cart,
  tripId: string,
  departurePointId?: string
): boolean {
  return cart.some((item) => {
    if (item.id !== tripId) return false;
    
    const itemDepPointId = item.departurePointId || undefined;
    const checkDepPointId = departurePointId || undefined;
    
    // Jeśli oba są undefined, to są równe
    if (!itemDepPointId && !checkDepPointId) return true;
    
    // Jeśli oba mają wartości, porównaj je
    if (itemDepPointId && checkDepPointId) {
      return itemDepPointId === checkDepPointId;
    }
    
    // Jeden ma wartość, drugi nie - nie są równe
    return false;
  });
}


