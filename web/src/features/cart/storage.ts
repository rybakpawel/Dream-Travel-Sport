import type { Cart } from "./types";

export const CART_KEY = "dtsCart";
export const MAX_QTY_PER_TRIP = 5;

function isCartItem(value: unknown): value is {
  id: unknown;
  qty: unknown;
  departurePointId?: unknown;
  priceCents?: unknown;
} {
  return (
    !!value &&
    typeof value === "object" &&
    "id" in value &&
    "qty" in value
  );
}

function clampQty(qty: number): number {
  return Math.max(1, Math.min(MAX_QTY_PER_TRIP, Math.trunc(qty)));
}

export function loadCart(): Cart {
  try {
    const raw = localStorage.getItem(CART_KEY);
    if (!raw) return [];

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(isCartItem)
      .filter(
        (item) =>
          typeof item.id === "string" &&
          typeof item.qty === "number" &&
          Number.isFinite(item.qty)
      )
      .map((item) => ({
        id: item.id as string,
        qty: clampQty(item.qty as number),
        departurePointId:
          typeof item.departurePointId === "string"
            ? item.departurePointId
            : undefined,
        priceCents:
          typeof item.priceCents === "number" && Number.isFinite(item.priceCents)
            ? item.priceCents
            : undefined
      }));
  } catch {
    return [];
  }
}

export function saveCart(cart: Cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  try {
    // Umożliwia natychmiastową aktualizację UI (np. badge koszyka) bez odświeżania strony.
    window.dispatchEvent(new CustomEvent("dts:cart-changed", { detail: { cart } }));
  } catch {
    // ignore
  }
}


