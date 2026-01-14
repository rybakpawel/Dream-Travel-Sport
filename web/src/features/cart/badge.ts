import { CART_KEY, loadCart } from "./storage.js";

function formatQty(qty: number): string {
  if (!Number.isFinite(qty) || qty <= 0) return "0";
  if (qty > 99) return "99+";
  return String(qty);
}

function getCartTotalQty(): number {
  const cart = loadCart();
  return cart.length; // Liczba wyjazdów, nie uczestników
}

export function updateCartBadge(): void {
  const qty = getCartTotalQty();
  const displayQty = formatQty(qty);

  const badges = document.querySelectorAll<HTMLElement>("[data-cart-badge]");
  badges.forEach((badge) => {
    if (qty > 0) {
      badge.textContent = displayQty;
      badge.classList.add("is-visible");
    } else {
      badge.textContent = "";
      badge.classList.remove("is-visible");
    }
  });

  const links = document.querySelectorAll<HTMLAnchorElement>("a.cart-link");
  links.forEach((link) => {
    const label = qty > 0 ? `Koszyk (${displayQty})` : "Koszyk";
    link.setAttribute("aria-label", label);
    link.setAttribute("title", label);
  });
}

function initCartBadge(): void {
  updateCartBadge();

  // Aktualizacje w obrębie tej samej karty (emitowane w saveCart)
  window.addEventListener("dts:cart-changed", () => updateCartBadge());

  // Aktualizacje między kartami (storage event)
  window.addEventListener("storage", (e) => {
    if (e.key === CART_KEY) {
      updateCartBadge();
    }
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initCartBadge, { once: true });
} else {
  initCartBadge();
}


