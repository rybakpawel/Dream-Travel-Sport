import { tripsApi } from "../api/client.js";
import { checkoutApi, ordersApi, paymentsApi } from "../api/client.js";
const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3001/api";
import { addTrip, setItemQty, removeItem } from "../features/cart/operations.js";
import { initCartPage as initCartPageLegacy } from "../features/cart/page.js";
import { renderCart } from "../features/cart/render.js";
import type { Cart } from "../features/cart/types.js";
import { loadCart, saveCart } from "../features/cart/storage.js";
import {
  loadCartFromBackend,
  saveCartToBackend,
  syncCartWithBackend
} from "../features/cart/sync.js";
import { readQueryTrip, removeTripFromUrl } from "../features/cart/url.js";
import { applyPointsToSession, requestMagicLink } from "../features/checkout/magic-link.js";
import {
  createCheckoutSession,
  getCheckoutSession,
  getCurrentSessionId,
  setCurrentSessionId
} from "../features/checkout/session.js";
import {
  handleInvalidSession,
  handleMultipleTabs,
  validateSessionBeforeAction
} from "../features/checkout/validation.js";
import {
  clearFieldErrors,
  showFieldErrors,
  validateBirthDate,
  validateEmail,
  validateName,
  validatePhone,
  validateForm,
  type ValidationRules
} from "../utils/form-validation.js";
import { setButtonLoading, withButtonLoading } from "../utils/loading.js";
import { notifications } from "../utils/notifications.js";

type TripFromApi = {
  id: string;
  slug: string;
  name: string;
  details: string;
  priceCents: number;
  capacity: number | null;
  seatsLeft: number | null;
  availability: string;
  hotelClass: number | null;
};

// Sprawdź czy jest magic link w URL
const urlParams = new URLSearchParams(window.location.search);
const magicLinkToken = urlParams.get("token");
const sessionFromUrl = urlParams.get("session");
const pointsFromUrl = urlParams.get("points");
const errorFromUrl = urlParams.get("error");
const errorMessageFromUrl = urlParams.get("message");

// Obsłuż błędy z magic linku (jeśli są w URL)
if (errorFromUrl && errorMessageFromUrl) {
  // Pokaż ładny komunikat błędu zamiast surowego JSON
  notifications.error(decodeURIComponent(errorMessageFromUrl));
  
  // Usuń parametry błędu z URL (żeby nie pokazywać się przy odświeżeniu)
  const newUrl = new URL(window.location.href);
  newUrl.searchParams.delete("error");
  newUrl.searchParams.delete("message");
  window.history.replaceState({}, "", newUrl.toString());
}

// Flaga wskazująca że mamy sesję z magic linku - wymaga synchronizacji koszyka z backendem
let hasSessionFromMagicLink = false;
if (sessionFromUrl) {
  // Mamy sesję checkoutu z URL (np. po magic link / po wznowieniu).
  // Użyj osobnego localStorage key dla magic linku (izolacja od normalnego checkoutu)
  setCurrentSessionId(sessionFromUrl, true);
  hasSessionFromMagicLink = true;
  if (pointsFromUrl) {
    // Zastosuj punkty do sesji
    applyPointsToSession(sessionFromUrl, parseInt(pointsFromUrl, 10)).catch(console.error);
  }
}

async function initCartPage() {
  // 0) Jeśli mamy sesję z magic linku, najpierw zsynchronizuj koszyk z backendem
  // (to jest źródło prawdy - magic link używa koszyka z sesji backendowej)
  // UWAGA: Nie zapisujemy do localStorage - magic link jest izolowany
  if (hasSessionFromMagicLink && sessionFromUrl) {
    try {
      await loadCartFromBackend(sessionFromUrl, true);
      // Koszyk magic linku jest tylko w backendzie, nie w localStorage
    } catch (err) {
      console.error("Failed to sync cart from magic link session:", err);
      // W przypadku błędu, kontynuuj z pustym koszykiem (magic link nie używa localStorage)
    }
  }

  // 1) Add trip from query string (if present)
  const tripFromUrl = readQueryTrip();
  if (tripFromUrl) {
    // Sprawdź czy trip istnieje w API (używamy slug)
    try {
      const trip = (await tripsApi.getBySlug(tripFromUrl)) as TripFromApi;
      if (trip) {
        // Sprawdź dostępność miejsc przed dodaniem do koszyka
        const hasCapacity = trip.capacity === null || trip.seatsLeft === null || trip.seatsLeft > 0;
        const isOpen = trip.availability === "OPEN";

        if (!hasCapacity || !isOpen) {
          notifications.error(
            trip.seatsLeft === 0
              ? `Wyjazd "${trip.name}" nie ma już dostępnych miejsc.`
              : `Wyjazd "${trip.name}" nie jest obecnie dostępny.`
          );
          removeTripFromUrl();
          return;
        }

        // Użyj slug jako ID w koszyku
        const next = addTrip(loadCart(), tripFromUrl);
        saveCart(next);
        removeTripFromUrl();
      }
    } catch (err) {
      console.error("Trip not found in API:", err);
      // Jeśli trip nie istnieje w API, nie dodawaj go do koszyka
    }
  }

  // Pozwala bezpiecznie wołać aktualizację Dream Points także z miejsc,
  // które wykonują się przed konfiguracją sekcji (np. pierwsze renderowanie koszyka).
  let updateLoyaltyPointsDisplayFromDom: () => void = () => {};

  // 2) Render + wire handlers
  const rerender = async () => {
    // Jeśli mamy aktywną sesję checkoutu, zsynchronizuj koszyk z backendem
    // (backend jest źródłem prawdy dla koszyka z magic linku)
    const currentSessionId = getCurrentSessionId(hasSessionFromMagicLink);
    const cart = currentSessionId
      ? await syncCartWithBackend(currentSessionId, hasSessionFromMagicLink)
      : loadCart();

    await renderCart({
      cart,
      onQtyChange: async (index, qty) => {
        try {
          const currentCart = currentSessionId
            ? await syncCartWithBackend(currentSessionId, hasSessionFromMagicLink)
            : loadCart();
          const next = setItemQty(currentCart, index, qty);
          if (currentSessionId) {
            try {
              await saveCartToBackend(next, currentSessionId, hasSessionFromMagicLink);
            } catch (err) {
              const errorMessage = err instanceof Error ? err.message : String(err);
              if (errorMessage.includes("PAID") || errorMessage.includes("zakończona")) {
                // Sesja jest PAID - wyczyść sesję i koszyk (zamówienie zostało już złożone)
                setCurrentSessionId(null, hasSessionFromMagicLink);
                // WAŻNE: Wyczyść localStorage zawsze, bo zamówienie zostało już złożone
                saveCart([]);
                notifications.warning("To zamówienie zostało już złożone. Koszyk został wyczyszczony.");
                rerender();
              } else {
                throw err;
              }
            }
          } else {
            saveCart(next);
          }
          rerender();
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          if (errorMessage.includes("PAID") || errorMessage.includes("zakończona")) {
            // Sesja jest PAID - zsynchronizuj z backendem (zwróci pusty koszyk)
            await syncCartWithBackend(currentSessionId, hasSessionFromMagicLink);
            setCurrentSessionId(null, hasSessionFromMagicLink);
            // WAŻNE: Wyczyść localStorage zawsze, bo może zawierać stary koszyk
            saveCart([]);
            notifications.warning("To zamówienie zostało już złożone. Koszyk został wyczyszczony.");
            rerender();
          } else {
            notifications.error("Nie udało się zmienić ilości. Spróbuj ponownie.");
          }
        }
      },
      onRemoveItem: async (index) => {
        try {
          const currentCart = currentSessionId
            ? await syncCartWithBackend(currentSessionId, hasSessionFromMagicLink)
            : loadCart();
          const next = removeItem(currentCart, index);
          if (currentSessionId) {
            try {
              await saveCartToBackend(next, currentSessionId, hasSessionFromMagicLink);
            } catch (err) {
              const errorMessage = err instanceof Error ? err.message : String(err);
              if (errorMessage.includes("PAID") || errorMessage.includes("zakończona")) {
                // Sesja jest PAID - wyczyść sesję i koszyk (zamówienie zostało już złożone)
                setCurrentSessionId(null, hasSessionFromMagicLink);
                // WAŻNE: Wyczyść localStorage zawsze, bo zamówienie zostało już złożone
                saveCart([]);
                notifications.warning("To zamówienie zostało już złożone. Koszyk został wyczyszczony.");
                rerender();
              } else {
                throw err;
              }
            }
          } else {
            saveCart(next);
          }
          rerender();
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          if (errorMessage.includes("PAID") || errorMessage.includes("zakończona")) {
            // Sesja jest PAID - zsynchronizuj z backendem (zwróci pusty koszyk)
            await syncCartWithBackend(currentSessionId, hasSessionFromMagicLink);
            setCurrentSessionId(null, hasSessionFromMagicLink);
            // WAŻNE: Wyczyść localStorage zawsze, bo może zawierać stary koszyk
            saveCart([]);
            notifications.warning("To zamówienie zostało już złożone. Koszyk został wyczyszczony.");
            rerender();
          } else {
            notifications.error("Nie udało się usunąć pozycji. Spróbuj ponownie.");
          }
        }
      }
    });

    // Po każdym rerenderze zaktualizuj wyświetlaną zniżkę z punktów (jeśli sekcja jest widoczna)
    updateLoyaltyPointsDisplayFromDom();
    
    // Zaktualizuj badge koszyka (również dla magic linku)
    // W magic linku zapisz koszyk do localStorage TYLKO dla badge (nie modyfikuje logiki)
    if (hasSessionFromMagicLink && currentSessionId && cart.length > 0) {
      // Tymczasowo zapisz koszyk do localStorage dla badge (tylko do odczytu)
      // To nie wpływa na izolację magic linku, bo badge tylko czyta
      saveCart(cart);
      // Wywołaj event żeby badge się zaktualizował
      window.dispatchEvent(new CustomEvent("dts:cart-changed", { detail: { cart } }));
    }
  };

  await rerender();

  // 3) Podepnij formularz zamówienia
  const orderForm = document.querySelector<HTMLButtonElement>(".btn-order");
  const checkoutFormsContainer = document.getElementById("checkout-forms");
  const emailInput = document.querySelector<HTMLInputElement>('input[name="customerEmail"]');
  const nameInput = document.querySelector<HTMLInputElement>('input[name="customerName"]');
  const phoneInput = document.querySelector<HTMLInputElement>('input[name="customerPhone"]');
  const invoiceCompanyCheckbox = document.getElementById("invoice-company") as HTMLInputElement | null;
  const invoiceCompanyFields = document.getElementById("invoice-company-fields");
  const companyNameInput = document.querySelector<HTMLInputElement>('input[name="companyName"]');
  const companyTaxIdInput = document.querySelector<HTMLInputElement>('input[name="companyTaxId"]');
  const companyAddressInput = document.querySelector<HTMLInputElement>('input[name="companyAddress"]');

  if (orderForm && emailInput && checkoutFormsContainer) {
    // ===== Dream Points UX =====
    const loyaltyPointsSection = document.getElementById("loyalty-points-section");
    const loyaltyVerifySection = document.getElementById("loyalty-verify-section");
    const loyaltyEarnSection = document.getElementById("loyalty-earn-section");
    const pointsToEarnEl = document.getElementById("points-to-earn");
    const requestMagicLinkBtn = document.getElementById(
      "request-magic-link-btn"
    ) as HTMLButtonElement | null;
    const magicLinkDevBox = document.getElementById("magic-link-dev");
    const loyaltyVerifyInfo = loyaltyVerifySection?.querySelector(".info-box") as HTMLElement | null;
    const DEFAULT_VERIFY_MESSAGE =
      "Chcesz użyć Dream Points? Wyślemy jednorazowy link na Twój e-mail, aby bezpiecznie aktywować punkty w tym koszyku.";
    const usePointsCheckbox = document.getElementById("use-points-checkbox") as HTMLInputElement | null;
    const availablePointsEl = document.getElementById("available-points");
    const pointsDiscountEl = document.getElementById("points-discount");

    let loyaltySessionId: string | null = null;
    let loyaltyAvailablePoints = 0;
    let loyaltyPointsReserved = 0;
    let loyaltyListenerBound = false;
    let magicLinkListenerBound = false;
    let loyaltyRefreshInFlight = false;
    let loyaltyDebounceTimer: number | null = null;
    let loyaltyApplyInFlight = false;
    let loyaltyApplyTimer: number | null = null;
    let loyaltyPendingApply: number | null = null;

    function getTotalCentsFromDom(): number {
      const totalPriceEl = document.getElementById("cart-total-price");
      const dataCents = (totalPriceEl as HTMLElement | null)?.dataset?.totalCents;
      if (dataCents) {
        const parsed = Number.parseInt(dataCents, 10);
        if (Number.isFinite(parsed)) return Math.max(0, parsed);
      }
      const raw = totalPriceEl?.textContent || "";
      // np. "1 234,56 zł" -> "1234,56" -> 1234.56
      const normalized = raw
        .replace(/[^\d,.\s]/g, "") // usuń walutę i litery
        .replace(/\s/g, "") // usuń spacje i NBSP
        .replace(",", ".")
        .trim();
      const value = normalized ? Number.parseFloat(normalized) : 0;
      if (!Number.isFinite(value)) return 0;
      return Math.max(0, Math.round(value * 100));
    }

    function formatMoneyFromCents(cents: number): string {
      return (cents / 100).toLocaleString("pl-PL") + " zł";
    }

    function getEffectivePointsForDiscount(baseTotalCents: number): number {
      const maxPointsByLimit = Math.floor(baseTotalCents / 500); // 20% limit
      const effectivePoints =
        usePointsCheckbox && usePointsCheckbox.checked
          ? Math.min(loyaltyPointsReserved, maxPointsByLimit)
          : 0;
      return Math.max(0, effectivePoints);
    }

    function getFinalTotalCentsForEarning(baseTotalCents: number): number {
      const effectivePoints = getEffectivePointsForDiscount(baseTotalCents);
      const discountCents = Math.min(effectivePoints * 100, baseTotalCents);
      return Math.max(0, baseTotalCents - discountCents);
    }

    function hideLoyaltyEarnSection() {
      if (loyaltyEarnSection) loyaltyEarnSection.style.display = "none";
      if (pointsToEarnEl) pointsToEarnEl.textContent = "0";
    }

    function showLoyaltyEarnSection(pointsToEarn: number) {
      if (!loyaltyEarnSection || !pointsToEarnEl) return;
      if (pointsToEarn <= 0) {
        hideLoyaltyEarnSection();
        return;
      }
      loyaltyEarnSection.style.display = "block";
      pointsToEarnEl.textContent = String(pointsToEarn);
    }

    function updateTotalToPayUi() {
      const totalPriceEl = document.getElementById("cart-total-price") as HTMLElement | null;
      if (!totalPriceEl) return;

      const baseTotalCents = getTotalCentsFromDom();
      const maxPointsByLimit = Math.floor(baseTotalCents / 500); // 20% limit
      const effectivePoints =
        usePointsCheckbox && usePointsCheckbox.checked
          ? Math.min(loyaltyPointsReserved, maxPointsByLimit)
          : 0;
      const discountCents = Math.min(effectivePoints * 100, baseTotalCents);

      if (discountCents <= 0) {
        totalPriceEl.textContent = formatMoneyFromCents(baseTotalCents);
        totalPriceEl.setAttribute("aria-label", formatMoneyFromCents(baseTotalCents));
        return;
      }

      const newTotalCents = Math.max(0, baseTotalCents - discountCents);
      totalPriceEl.innerHTML = `
        <span class="price-old">${formatMoneyFromCents(baseTotalCents)}</span>
        <span class="price-new">${formatMoneyFromCents(newTotalCents)}</span>
      `.trim();
      totalPriceEl.setAttribute(
        "aria-label",
        `${formatMoneyFromCents(newTotalCents)} (zamiast ${formatMoneyFromCents(baseTotalCents)})`
      );
    }

    function hideLoyaltyVerifySection() {
      if (loyaltyVerifySection) loyaltyVerifySection.style.display = "none";
      if (requestMagicLinkBtn) requestMagicLinkBtn.style.display = "";
      if (loyaltyVerifyInfo) loyaltyVerifyInfo.textContent = DEFAULT_VERIFY_MESSAGE;
      if (magicLinkDevBox) {
        magicLinkDevBox.style.display = "none";
        magicLinkDevBox.textContent = "";
      }
    }

    function buildLoyaltyVerifyMessage(pointsBalance: number): string {
      const totalCents = getTotalCentsFromDom();
      const maxPointsByLimit = Math.floor(totalCents / 500); // 20% limit
      const maxUsablePoints = Math.max(0, Math.min(pointsBalance, maxPointsByLimit));
      const discountCents = Math.min(maxUsablePoints * 100, totalCents);
      const newTotalCents = Math.max(0, totalCents - discountCents);

      const usableText =
        pointsBalance > 0 && maxUsablePoints < pointsBalance
          ? `${maxUsablePoints}/${pointsBalance}`
          : String(maxUsablePoints);

      return [
        `Masz ${pointsBalance} Dream Points.`,
        `W tej rezerwacji możesz użyć do ${usableText} (zniżka ${formatMoneyFromCents(
          discountCents
        )}, do zapłaty ${formatMoneyFromCents(newTotalCents)}).`,
        "Wyślemy jednorazowy link na Twój e-mail, aby bezpiecznie aktywować punkty w tym koszyku."
      ].join(" ");
    }

    function showLoyaltyVerifySection(message: string, showButton: boolean) {
      if (!loyaltyVerifySection) return;
      loyaltyVerifySection.style.display = "block";
      if (loyaltyVerifyInfo) loyaltyVerifyInfo.textContent = message;
      if (requestMagicLinkBtn) requestMagicLinkBtn.style.display = showButton ? "" : "none";
      if (magicLinkDevBox) {
        magicLinkDevBox.style.display = "none";
        magicLinkDevBox.textContent = "";
      }
    }

    function hideLoyaltySection() {
      if (loyaltyPointsSection) loyaltyPointsSection.style.display = "none";
      if (usePointsCheckbox) {
        usePointsCheckbox.checked = false;
        usePointsCheckbox.disabled = false;
      }
      if (availablePointsEl) availablePointsEl.textContent = "0";
      if (pointsDiscountEl) pointsDiscountEl.textContent = "0 zł";
      loyaltyAvailablePoints = 0;
      loyaltyPointsReserved = 0;
      updateTotalToPayUi();
    }

    function hideLoyaltyUi() {
      hideLoyaltyVerifySection();
      hideLoyaltySection();
    }

    function updateLoyaltyPointsDisplayFromDomImpl() {
      // Preview: ile punktów użytkownik zarobi w tej rezerwacji (na bazie finalnej kwoty do zapłaty)
      if (loyaltyEarnSection && loyaltyEarnSection.style.display !== "none") {
        const baseTotalCents = getTotalCentsFromDom();
        const finalTotalCents = getFinalTotalCentsForEarning(baseTotalCents);
        const pointsToEarn = Math.floor(finalTotalCents / 1000); // 10% wartości w PLN (1 pkt = 1 zł)
        if (pointsToEarnEl) pointsToEarnEl.textContent = String(pointsToEarn);
      }

      // Jeśli widzimy sekcję weryfikacji (przed magic linkiem), a mamy preview punktów,
      // to aktualizuj komunikat (np. gdy zmieniła się liczba uczestników i suma koszyka).
      if (
        loyaltyVerifySection &&
        loyaltyVerifySection.style.display !== "none" &&
        loyaltyVerifyInfo &&
        loyaltyAvailablePoints > 0
      ) {
        loyaltyVerifyInfo.textContent = buildLoyaltyVerifyMessage(loyaltyAvailablePoints);
      }

      if (
        !loyaltyPointsSection ||
        loyaltyPointsSection.style.display === "none" ||
        !availablePointsEl ||
        !pointsDiscountEl
      ) {
        return;
      }

      const totalCents = getTotalCentsFromDom();
      // Limit: max 20% wartości zamówienia, 1 pkt = 1 zł => totalCents/500
      const maxPointsByLimit = Math.floor(totalCents / 500);

      // Jeśli checkbox jest zaznaczony, UX-owo traktujemy to jako "użyj maksymalnie ile się da"
      // (limit 20% + dostępne punkty). Przy zmianie koszyka automatycznie dopasowujemy rezerwację.
      const desiredReserved = usePointsCheckbox?.checked
        ? Math.min(loyaltyAvailablePoints, maxPointsByLimit)
        : 0;

      if (usePointsCheckbox?.checked && loyaltySessionId && desiredReserved !== loyaltyPointsReserved) {
        loyaltyPointsReserved = desiredReserved;
        scheduleApplyPoints(desiredReserved);
      }

      const pointsToShow = usePointsCheckbox?.checked
        ? desiredReserved
        : Math.min(loyaltyAvailablePoints, maxPointsByLimit);

      // Pokaż w formie "X/Y" jeśli użytkownik ma więcej punktów niż może wykorzystać w tej transakcji
      if (loyaltyAvailablePoints > 0 && pointsToShow < loyaltyAvailablePoints) {
        availablePointsEl.textContent = `${pointsToShow}/${loyaltyAvailablePoints}`;
      } else {
        availablePointsEl.textContent = String(pointsToShow);
      }

      const discountCents = Math.min(pointsToShow * 100, totalCents);
      pointsDiscountEl.textContent = (discountCents / 100).toLocaleString("pl-PL") + " zł";
      updateTotalToPayUi();
    }

    async function runApplyPointsIfNeeded() {
      if (!loyaltySessionId) return;
      if (!usePointsCheckbox) return;
      if (loyaltyApplyInFlight) return;
      if (loyaltyPendingApply === null) return;

      const target = loyaltyPendingApply;
      loyaltyPendingApply = null;
      loyaltyApplyInFlight = true;

      try {
        const canProceed = await handleInvalidSession(loyaltySessionId, "rezerwację punktów");
        if (!canProceed) return;

        await checkoutApi.applyPoints(loyaltySessionId, target);
        const updated = await getCheckoutSession(loyaltySessionId);
        loyaltyAvailablePoints = updated.session.loyaltyPoints ?? loyaltyAvailablePoints;
        loyaltyPointsReserved = updated.session.pointsReserved ?? 0;
        usePointsCheckbox.checked = loyaltyPointsReserved > 0;
        updateLoyaltyPointsDisplayFromDomImpl();
      } catch (err) {
        console.error("Failed to auto-adjust points reservation:", err);
        // Jeśli nie udało się zsynchronizować, wymuś ponowne odczytanie sesji (bez blokowania UX)
        try {
          const updated = await getCheckoutSession(loyaltySessionId);
          loyaltyAvailablePoints = updated.session.loyaltyPoints ?? loyaltyAvailablePoints;
          loyaltyPointsReserved = updated.session.pointsReserved ?? 0;
          usePointsCheckbox.checked = loyaltyPointsReserved > 0;
          updateLoyaltyPointsDisplayFromDomImpl();
        } catch {}
      } finally {
        loyaltyApplyInFlight = false;
        if (loyaltyPendingApply !== null) {
          runApplyPointsIfNeeded().catch(() => {});
        }
      }
    }

    function scheduleApplyPoints(target: number) {
      loyaltyPendingApply = target;
      if (loyaltyApplyTimer) {
        window.clearTimeout(loyaltyApplyTimer);
      }
      loyaltyApplyTimer = window.setTimeout(() => {
        runApplyPointsIfNeeded().catch((err) =>
          console.warn("Auto-apply points failed:", err)
        );
      }, 350);
    }

    // Podmień globalny no-op na właściwą implementację (wykorzystywaną też po rerenderach koszyka)
    updateLoyaltyPointsDisplayFromDom = updateLoyaltyPointsDisplayFromDomImpl;

    async function ensureCheckoutSessionForEmail(email: string, cart: Cart): Promise<string> {
      // Jeśli jesteśmy w magic linku, nie używaj istniejących sesji (izolacja)
      if (hasSessionFromMagicLink) {
        const currentSessionId = getCurrentSessionId(true);
        if (currentSessionId) {
          // Użyj sesji magic linku (już istnieje)
          return currentSessionId;
        }
      }

      const currentSessionId = getCurrentSessionId(false);
      if (currentSessionId) {
        try {
          const existing = await getCheckoutSession(currentSessionId);
          const status = existing.session.status;
          const emailMatches = existing.session.customerEmail === email;
          if (status === "PENDING" && emailMatches) {
            await saveCartToBackend(cart, currentSessionId, false);
            setCurrentSessionId(currentSessionId, false);
            return currentSessionId;
          }
          // Jeśli sesja jest PAID (zamówienie zostało złożone), usuń ją i utwórz nową
          if (status === "PAID") {
            setCurrentSessionId(null, false);
            // Kontynuuj do utworzenia nowej sesji
          }
        } catch {
          // ignore i utwórz nową sesję
        }
      }

      const newSessionId = await createCheckoutSession(email, cart);
      setCurrentSessionId(newSessionId, false);
      await saveCartToBackend(cart, newSessionId, false);
      return newSessionId;
    }

    async function refreshLoyaltyPointsUi(): Promise<void> {
      if (
        !loyaltyVerifySection ||
        !loyaltyEarnSection ||
        !pointsToEarnEl ||
        !requestMagicLinkBtn ||
        !loyaltyPointsSection ||
        !usePointsCheckbox ||
        !availablePointsEl ||
        !pointsDiscountEl
      ) {
        return;
      }

      // Nie pokazuj sekcji jeśli email nie jest poprawny
      if (!emailInput) {
        return;
      }
      const email = emailInput.value.trim();
      if (validateEmail(email)) {
        hideLoyaltyUi();
        hideLoyaltyEarnSection();
        return;
      }

      // Jeśli mamy aktywną sesję, użyj koszyka z backendu (źródło prawdy)
      // W magic linku używamy sesji magic linku, w normalnym checkoutcie normalnej sesji
      const currentSessionId = getCurrentSessionId(hasSessionFromMagicLink);
      const cart = currentSessionId
        ? await syncCartWithBackend(currentSessionId, hasSessionFromMagicLink)
        : loadCart();
      if (cart.length === 0) {
        hideLoyaltyUi();
        hideLoyaltyEarnSection();
        return;
      }

      const totalCents = getTotalCentsFromDom();
      const maxPointsByLimit = Math.floor(totalCents / 500);
      if (maxPointsByLimit <= 0) {
        hideLoyaltyUi();
        hideLoyaltyEarnSection();
        return;
      }

      if (loyaltyRefreshInFlight) return;
      loyaltyRefreshInFlight = true;

      try {
        // W normalnym checkoutcie utwórz/znajdź sesję dla tego emaila
        // W magic linku użyj istniejącej sesji magic linku
        const sessionId = await ensureCheckoutSessionForEmail(email, cart);
        loyaltySessionId = sessionId;

        // Sprawdź czy sesja jest nadal aktywna
        const canProceed = await handleInvalidSession(sessionId, "sprawdzenie punktów");
        if (!canProceed) {
          hideLoyaltyUi();
          return;
        }

        const session = await getCheckoutSession(sessionId);
        const loyaltyVerified = (session.session as unknown as { loyaltyVerified?: boolean })
          .loyaltyVerified;

        const pointsBalance = session.session.loyaltyPoints ?? 0;
        const hasPoints = session.session.hasLoyaltyPoints && pointsBalance > 0;

        if (!hasPoints) {
          hideLoyaltyUi();
          // Nowy adres / brak punktów: pokaż ile punktów zarobi za tę rezerwację
          const finalTotalCents = getFinalTotalCentsForEarning(totalCents);
          const pointsToEarn = Math.floor(finalTotalCents / 1000);
          showLoyaltyEarnSection(pointsToEarn);
          return;
        }

        // Jeśli użytkownik ma punkty, nie pokazuj sekcji "zarobisz X" (żeby nie dublować UI)
        hideLoyaltyEarnSection();

        // Trzymamy preview punktów w stanie, żeby móc pokazać informację przed wysłaniem linku
        // oraz aktualizować ją gdy zmienia się suma koszyka.
        loyaltyAvailablePoints = pointsBalance;
        loyaltyPointsReserved = session.session.pointsReserved ?? 0;

        if (!loyaltyVerified) {
          // Zanim pokażemy checkbox i pozwolimy użyć punktów, wymagamy weryfikacji emaila magic linkiem.
          hideLoyaltySection();
          showLoyaltyVerifySection(buildLoyaltyVerifyMessage(pointsBalance), true);
          return;
        }

        // WAŻNE: Checkbox do użycia punktów jest dostępny TYLKO w magic linku
        // W normalnym checkoutcie, nawet jeśli sesja jest zweryfikowana, nie pokazuj checkboxa
        if (!hasSessionFromMagicLink) {
          // W normalnym checkoutcie pokaż przycisk magic linku (nie checkbox)
          hideLoyaltySection();
          showLoyaltyVerifySection(buildLoyaltyVerifyMessage(pointsBalance), true);
          return;
        }

        hideLoyaltyVerifySection();

        // Po weryfikacji w magic linku: pokaż checkbox i pozwól użyć punktów
        // (hasPoints już sprawdziliśmy wyżej, ale zostawiamy defensywnie).
        if (loyaltyAvailablePoints <= 0) {
          hideLoyaltyUi();
          return;
        }

        usePointsCheckbox.checked = loyaltyPointsReserved > 0;
        loyaltyPointsSection.style.display = "block";
        updateLoyaltyPointsDisplayFromDomImpl();

        if (!loyaltyListenerBound) {
          loyaltyListenerBound = true;
          usePointsCheckbox.addEventListener("change", async () => {
            if (!loyaltySessionId) return;

            const totalCents = getTotalCentsFromDom();
            const maxPointsByLimit = Math.floor(totalCents / 500);
            const pointsToReserve = usePointsCheckbox.checked
              ? Math.min(loyaltyAvailablePoints, maxPointsByLimit)
              : 0;

            if (usePointsCheckbox.checked && pointsToReserve <= 0) {
              usePointsCheckbox.checked = false;
              notifications.warning("Nie możesz użyć punktów dla tej kwoty zamówienia.");
              return;
            }

            // Sprawdź czy sesja jest nadal aktywna
            const canProceed = await handleInvalidSession(
              loyaltySessionId,
              usePointsCheckbox.checked ? "rezerwację punktów" : "zwolnienie punktów"
            );
            if (!canProceed) {
              // przywróć poprzedni stan
              usePointsCheckbox.checked = !usePointsCheckbox.checked;
              return;
            }

            usePointsCheckbox.disabled = true;
            try {
              await checkoutApi.applyPoints(loyaltySessionId, pointsToReserve);
              const updated = await getCheckoutSession(loyaltySessionId);
              loyaltyAvailablePoints = updated.session.loyaltyPoints ?? loyaltyAvailablePoints;
              loyaltyPointsReserved = updated.session.pointsReserved ?? 0;
              usePointsCheckbox.checked = loyaltyPointsReserved > 0;
              updateLoyaltyPointsDisplayFromDomImpl();
            } catch (err) {
              console.error("Failed to apply points:", err);
              usePointsCheckbox.checked = false;
              loyaltyPointsReserved = 0;
              updateLoyaltyPointsDisplayFromDomImpl();
              notifications.error("Nie udało się zarezerwować punktów. Spróbuj ponownie.");
            } finally {
              usePointsCheckbox.disabled = false;
            }
          });
        }
      } finally {
        loyaltyRefreshInFlight = false;
      }
    }

    // Odśwież punkty po wpisaniu emaila (z debounce) oraz po wyjściu z pola
    const scheduleRefresh = () => {
      if (loyaltyDebounceTimer) {
        window.clearTimeout(loyaltyDebounceTimer);
      }
      loyaltyDebounceTimer = window.setTimeout(() => {
        refreshLoyaltyPointsUi().catch((err) => console.warn("Loyalty UI refresh failed:", err));
      }, 500);
    };

    emailInput.addEventListener("input", scheduleRefresh);
    emailInput.addEventListener("blur", () => {
      refreshLoyaltyPointsUi().catch((err) => console.warn("Loyalty UI refresh failed:", err));
    });

    // Obsłuż przypadek autofill (przeglądarka wstawi email bez eventu input)
    scheduleRefresh();

    // Jeśli mamy sesję z magic linku, odśwież UI Dream Points żeby pokazać zniżkę
    // i zablokuj edycję emaila (magic link jest przypisany do konkretnego emaila)
    if (hasSessionFromMagicLink && sessionFromUrl && emailInput) {
      // Ustaw email z sesji (jeśli dostępny) żeby UI się odświeżyło
      (async () => {
        try {
          const session = await getCheckoutSession(sessionFromUrl);
          if (session.session.customerEmail) {
            emailInput.value = session.session.customerEmail;
            // Zablokuj edycję emaila - magic link jest przypisany do konkretnego emaila
            emailInput.readOnly = true;
            // Zachowaj normalny wygląd pola, ale dodaj subtelny wskaźnik że jest zablokowane
            emailInput.style.backgroundColor = "rgba(3,10,22,0.9)"; // Normalny kolor tła pola
            emailInput.style.cursor = "default";
            emailInput.style.opacity = "0.9"; // Subtelne przyciemnienie
            emailInput.style.borderColor = "rgba(255,255,255,0.2)"; // Subtelnie jaśniejszy border
            emailInput.title = "Email z magic linku - nie można zmienić";
            
            // Usuń event listenery na zmianę emaila (nie są potrzebne w magic linku)
            emailInput.removeEventListener("input", scheduleRefresh);
            emailInput.removeEventListener("blur", () => {
              refreshLoyaltyPointsUi().catch((err) => console.warn("Loyalty UI refresh failed:", err));
            });
          }
          // Odśwież UI Dream Points żeby pokazać zniżkę
          setTimeout(() => {
            // Wywołaj refresh po krótkim opóźnieniu, żeby UI się zaktualizowało
            if (emailInput) {
              refreshLoyaltyPointsUi().catch((err) => console.warn("Loyalty UI refresh failed:", err));
            }
          }, 300);
        } catch (err) {
          console.warn("Failed to refresh loyalty UI from magic link session:", err);
        }
      })();
    }

    // Weryfikacja Dream Points (magic link) - bez tego nie pokazujemy salda i nie pozwalamy użyć punktów
    if (requestMagicLinkBtn && !magicLinkListenerBound) {
      magicLinkListenerBound = true;
      requestMagicLinkBtn.addEventListener("click", async () => {
        if (!emailInput) {
          notifications.warning("Wpisz poprawny adres e-mail.");
          return;
        }
        const email = emailInput.value.trim();
        if (validateEmail(email)) {
          notifications.warning("Wpisz poprawny adres e-mail.");
          return;
        }

        // Jeśli mamy aktywną sesję, użyj koszyka z backendu (źródło prawdy)
        const currentSessionId = getCurrentSessionId(hasSessionFromMagicLink);
        const cart = currentSessionId
          ? await syncCartWithBackend(currentSessionId, hasSessionFromMagicLink)
          : loadCart();
        if (cart.length === 0) {
          notifications.warning("Koszyk jest pusty");
          return;
        }

        try {
          setButtonLoading(requestMagicLinkBtn, true, "Wysyłanie linku…");

          const sessionId = await ensureCheckoutSessionForEmail(email, cart);
          loyaltySessionId = sessionId;

          const canProceed = await handleInvalidSession(sessionId, "wysłanie linku do punktów");
          if (!canProceed) return;

          const resp = await checkoutApi.requestMagicLink({
            sessionId,
            customerEmail: email
          });

          const message =
            typeof (resp as any)?.message === "string"
              ? ((resp as any).message as string)
              : "Jeśli na tym adresie są dostępne Dream Points, wysłaliśmy link do ich użycia.";
          notifications.info(message);

          // DEV: jeśli email jest wyłączony, backend zwróci link w odpowiedzi
          const magicLink =
            typeof (resp as any)?.magicLink === "string" ? ((resp as any).magicLink as string) : "";
          if (magicLink && magicLinkDevBox) {
            magicLinkDevBox.style.display = "block";
            magicLinkDevBox.innerHTML = "";
            const label = document.createElement("div");
            label.textContent = "DEV: Otwórz link weryfikacyjny:";
            const a = document.createElement("a");
            a.href = magicLink;
            a.textContent = magicLink;
            a.style.wordBreak = "break-all";
            a.style.display = "block";
            a.style.marginTop = "6px";
            magicLinkDevBox.appendChild(label);
            magicLinkDevBox.appendChild(a);
          } else if (magicLinkDevBox) {
            magicLinkDevBox.style.display = "none";
            magicLinkDevBox.textContent = "";
          }
        } catch (err) {
          const msg =
            err instanceof Error ? err.message : "Nie udało się wysłać linku do użycia punktów.";
          notifications.error(msg);
        } finally {
          setButtonLoading(requestMagicLinkBtn, false);
        }
      });
    }

    // Ustaw tekst przycisku w zależności od wybranej metody płatności
    const updateOrderButtonLabel = () => {
      const provider = document.querySelector<HTMLInputElement>('input[name="pay"]:checked')?.value;
      orderForm.textContent =
        provider === "PRZELEWY24" ? "Złóż rezerwację i zapłać online" : "Złóż rezerwację";
    };
    document
      .querySelectorAll<HTMLInputElement>('input[name="pay"]:not([disabled])')
      .forEach((el) => el.addEventListener("change", updateOrderButtonLabel));
    updateOrderButtonLabel();

    // Obsługa pól do faktury na firmę
    const updateInvoiceFieldsVisibility = () => {
      const isCompany = invoiceCompanyCheckbox?.checked || false;
      if (invoiceCompanyFields) {
        invoiceCompanyFields.style.display = isCompany ? "" : "none";
      }
      if (!isCompany) {
        // wyczyść pola gdy nie są potrzebne
        if (companyNameInput) companyNameInput.value = "";
        if (companyTaxIdInput) companyTaxIdInput.value = "";
        if (companyAddressInput) companyAddressInput.value = "";
      }
    };
    invoiceCompanyCheckbox?.addEventListener("change", updateInvoiceFieldsVisibility);
    updateInvoiceFieldsVisibility();

    // Obsługa usuwania błędów z checkboxów po ich zaznaczeniu
    const acceptTermsCheckbox = document.getElementById("accept-terms") as HTMLInputElement | null;
    const acceptPowerOfAttorneyCheckbox = document.getElementById("accept-power-of-attorney") as HTMLInputElement | null;
    const acceptElectronicServiceCheckbox = document.getElementById("accept-electronic-service") as HTMLInputElement | null;

    const clearCheckboxError = (checkbox: HTMLInputElement | null) => {
      if (checkbox) {
        checkbox.classList.remove("field-error");
        const fieldGroup = checkbox.closest(".field-group");
        if (fieldGroup) {
          const errorEl = fieldGroup.querySelector(".field-error-message");
          if (errorEl) {
            errorEl.remove();
          }
        }
      }
    };

    acceptTermsCheckbox?.addEventListener("change", () => {
      if (acceptTermsCheckbox.checked) {
        clearCheckboxError(acceptTermsCheckbox);
      }
    });

    acceptPowerOfAttorneyCheckbox?.addEventListener("change", () => {
      if (acceptPowerOfAttorneyCheckbox.checked) {
        clearCheckboxError(acceptPowerOfAttorneyCheckbox);
      }
    });

    acceptElectronicServiceCheckbox?.addEventListener("change", () => {
      if (acceptElectronicServiceCheckbox.checked) {
        clearCheckboxError(acceptElectronicServiceCheckbox);
      }
    });

    // Obsługa przycisku "Podgląd umowy"
    const previewAgreementBtn = document.getElementById("preview-agreement-btn");
    if (previewAgreementBtn) {
      previewAgreementBtn.addEventListener("click", async () => {
        // Pobierz koszyk - jeśli mamy sesję, użyj koszyka z backendu (magic link lub normalna sesja)
        const currentSessionId = getCurrentSessionId(hasSessionFromMagicLink);
        const cart = currentSessionId
          ? await syncCartWithBackend(currentSessionId, hasSessionFromMagicLink)
          : loadCart();
        if (cart.length === 0) {
          notifications.warning("Koszyk jest pusty");
          return;
        }

        // Walidacja formularza (taka sama jak przy składaniu rezerwacji)
        clearFieldErrors(checkoutFormsContainer);

        const email = emailInput.value.trim();
        const name = nameInput?.value.trim() || "";
        const phone = phoneInput?.value.trim() || "";

        // Walidacja checkboxów (obowiązkowe)
        const acceptTermsCheckbox = document.getElementById("accept-terms") as HTMLInputElement | null;
        const acceptPowerOfAttorneyCheckbox = document.getElementById("accept-power-of-attorney") as HTMLInputElement | null;
        const acceptElectronicServiceCheckbox = document.getElementById("accept-electronic-service") as HTMLInputElement | null;

        const checkboxErrors: Record<string, string> = {};
        if (!acceptTermsCheckbox?.checked) {
          checkboxErrors.acceptTerms = "Musisz zaakceptować Regulamin i warunki";
          if (acceptTermsCheckbox) {
            acceptTermsCheckbox.classList.add("field-error");
          }
        }
        if (!acceptPowerOfAttorneyCheckbox?.checked) {
          checkboxErrors.acceptPowerOfAttorney = "Musisz potwierdzić posiadanie pełnomocnictwa";
          if (acceptPowerOfAttorneyCheckbox) {
            acceptPowerOfAttorneyCheckbox.classList.add("field-error");
          }
        }
        if (!acceptElectronicServiceCheckbox?.checked) {
          checkboxErrors.acceptElectronicService = "Musisz wyrazić zgodę na obsługę elektroniczną";
          if (acceptElectronicServiceCheckbox) {
            acceptElectronicServiceCheckbox.classList.add("field-error");
          }
        }

        // Walidacja podstawowych pól
        const validationRules: ValidationRules = {
          customerName: {
            required: true,
            custom: validateName
          },
          customerEmail: {
            required: true,
            custom: validateEmail
          },
          customerPhone: {
            required: true,
            custom: validatePhone
          }
        };

        // Dodatkowa walidacja dla faktury na firmę
        const isCompanyForValidation = invoiceCompanyCheckbox?.checked || false;
        if (isCompanyForValidation) {
          validationRules.companyName = { required: true, minLength: 2, message: "Podaj nazwę firmy" };
          validationRules.companyTaxId = {
            required: true,
            custom: (value) => {
              const digits = value.replace(/\D/g, "");
              if (digits.length !== 10) return "NIP musi mieć 10 cyfr";
              return null;
            }
          };
          validationRules.companyAddress = { required: true, minLength: 5, message: "Podaj adres firmy" };
        }

        const validation = validateForm(checkoutFormsContainer, validationRules);

        // Połącz błędy z checkboxów z błędami z formularza
        const allErrors = { ...validation.errors, ...checkboxErrors };

        if (!validation.isValid || Object.keys(checkboxErrors).length > 0) {
          showFieldErrors(checkoutFormsContainer, allErrors);
          // Pokaż pierwsze pole z błędem (checkboxy lub pola formularza)
          const firstErrorField = checkoutFormsContainer.querySelector(".field-error") as HTMLElement;
          if (firstErrorField) {
            firstErrorField.focus();
            firstErrorField.scrollIntoView({ behavior: "smooth", block: "center" });
          }
          notifications.error("Proszę poprawić błędy w formularzu");
          return;
        }

        try {
          setButtonLoading(previewAgreementBtn, true, "Generowanie podglądu oferty...");

          // Zbierz dane z formularza (już zwalidowane)
          const isCompany = invoiceCompanyCheckbox?.checked || false;
          const companyName = isCompany ? (companyNameInput?.value.trim() || null) : null;
          const companyTaxId = isCompany ? (companyTaxIdInput?.value.trim() || null) : null;
          const companyAddress = isCompany ? (companyAddressInput?.value.trim() || null) : null;

          // Pobierz koszyk - jeśli mamy sesję, użyj koszyka z backendu (zawiera informacje o zniżce)
          const currentSessionId = getCurrentSessionId(hasSessionFromMagicLink);
          const cart = currentSessionId
            ? await syncCartWithBackend(currentSessionId, hasSessionFromMagicLink)
            : loadCart();
          const tripsData = [];
          
          // Funkcja pomocnicza do normalizacji numeru dokumentu
          const normalizeDocumentNumber = (value: string) =>
            value.replace(/\s+/g, "").replace(/-/g, "").toUpperCase();
          
          // Pobierz informacje o zniżce z Dream Points (jeśli sesja jest zweryfikowana)
          let pointsDiscountCents = 0;
          if (currentSessionId) {
            try {
              const session = await getCheckoutSession(currentSessionId);
              const loyaltyVerified = (session.session as unknown as { loyaltyVerified?: boolean })
                .loyaltyVerified;
              const pointsReserved = session.session.pointsReserved ?? 0;
              if (loyaltyVerified && pointsReserved > 0 && usePointsCheckbox?.checked) {
                // Oblicz zniżkę z punktów
                let baseTotalCents = 0;
                for (const item of cart) {
                  if (item.priceCents !== undefined && item.priceCents !== null && item.priceCents > 0) {
                    baseTotalCents += item.priceCents * item.qty;
                  } else {
                    try {
                      const trip = (await tripsApi.getBySlug(item.id)) as TripFromApi;
                      baseTotalCents += (trip.priceCents || 0) * item.qty;
                    } catch {
                      // ignore
                    }
                  }
                }
                const maxPointsByLimit = Math.floor(baseTotalCents / 500);
                const effectivePoints = Math.min(pointsReserved, maxPointsByLimit);
                pointsDiscountCents = Math.min(effectivePoints * 100, baseTotalCents);
              }
            } catch (err) {
              console.warn("Failed to get points discount for PDF:", err);
            }
          }

          for (let itemIndex = 0; itemIndex < cart.length; itemIndex++) {
            const item = cart[itemIndex];
            if (!item.id) continue;
            try {
              const trip = (await tripsApi.getBySlug(item.id)) as TripFromApi;
              
              // Zbierz dane uczestników dla tego wyjazdu
              const passengers: Array<{
                firstName: string;
                lastName: string;
                birthDate: string;
                documentType: "ID_CARD" | "PASSPORT";
                documentNumber: string;
              }> = [];
              
              for (let passengerIndex = 0; passengerIndex < item.qty; passengerIndex++) {
                const firstNameInput = document.querySelector<HTMLInputElement>(
                  `input[name="item-${itemIndex}-passenger-${passengerIndex}-firstName"]`
                );
                const lastNameInput = document.querySelector<HTMLInputElement>(
                  `input[name="item-${itemIndex}-passenger-${passengerIndex}-lastName"]`
                );
                const birthDateInput = document.querySelector<HTMLInputElement>(
                  `input[name="item-${itemIndex}-passenger-${passengerIndex}-birthDate"]`
                );
                const documentTypeSelect = document.querySelector<HTMLSelectElement>(
                  `select[name="item-${itemIndex}-passenger-${passengerIndex}-documentType"]`
                );
                const documentInput = document.querySelector<HTMLInputElement>(
                  `input[name="item-${itemIndex}-passenger-${passengerIndex}-documentNumber"]`
                );
                
                if (firstNameInput && lastNameInput) {
                  passengers.push({
                    firstName: firstNameInput.value.trim(),
                    lastName: lastNameInput.value.trim(),
                    birthDate: birthDateInput?.value || "",
                    documentType: (documentTypeSelect?.value as "ID_CARD" | "PASSPORT") || "ID_CARD",
                    documentNumber: normalizeDocumentNumber(documentInput?.value.trim() || "")
                  });
                }
              }
              
              tripsData.push({
                tripId: trip.id,
                tripName: trip.name,
                tripDetails: trip.details,
                qty: item.qty,
                departurePointId: item.departurePointId,
                priceCents: item.priceCents || trip.priceCents || 0,
                passengers: passengers
              });
            } catch (err) {
              console.error(`Failed to load trip ${item.id}:`, err);
            }
          }

          // Wywołaj endpoint do generowania PDF
          const response = await fetch(`${API_BASE_URL}/checkout/preview-agreement`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              customerName: name,
              customerEmail: email,
              customerPhone: phone,
              invoiceType: isCompany ? "INVOICE_COMPANY" : "RECEIPT",
              companyName,
              companyTaxId,
              companyAddress,
              trips: tripsData,
              pointsDiscountCents: pointsDiscountCents // Przekaż zniżkę z Dream Points
            })
          });

          if (!response.ok) {
            // Spróbuj pobrać szczegóły błędu z odpowiedzi
            let errorMessage = "Nie udało się wygenerować podglądu oferty";
            try {
              const errorData = await response.json();
              if (errorData.message) {
                errorMessage = errorData.message;
              } else if (errorData.error) {
                errorMessage = errorData.error;
              }
            } catch {
              // Jeśli nie można sparsować JSON, użyj domyślnego komunikatu
            }
            throw new Error(errorMessage);
          }

          // Sprawdź czy odpowiedź to PDF
          const contentType = response.headers.get("content-type");
          if (!contentType || !contentType.includes("application/pdf")) {
            // Jeśli nie jest to PDF, spróbuj pobrać błąd
            try {
              const errorData = await response.json();
              throw new Error(errorData.message || errorData.error || "Otrzymano nieprawidłową odpowiedź z serwera");
            } catch (err) {
              if (err instanceof Error && err.message !== "Nie udało się wygenerować podglądu umowy") {
                throw err;
              }
              throw new Error("Serwer zwrócił nieprawidłową odpowiedź (oczekiwano PDF)");
            }
          }

          // Pobierz PDF jako blob i otwórz w nowym oknie
          const blob = await response.blob();
          const url = window.URL.createObjectURL(blob);
          window.open(url, "_blank");
          window.URL.revokeObjectURL(url);

          notifications.success("Podgląd oferty został wygenerowany");
        } catch (err) {
          console.error("Error generating agreement preview:", err);
          notifications.error(
            err instanceof Error
              ? err.message
              : "Nie udało się wygenerować podglądu umowy"
          );
        } finally {
          setButtonLoading(previewAgreementBtn, false);
        }
      });
    }

    orderForm.addEventListener("click", async () => {
      // Pobierz koszyk - jeśli mamy sesję, użyj koszyka z backendu (magic link lub normalna sesja)
      const currentSessionId = getCurrentSessionId(hasSessionFromMagicLink);
      const cart = currentSessionId
        ? await syncCartWithBackend(currentSessionId, hasSessionFromMagicLink)
        : loadCart();
      if (cart.length === 0) {
        notifications.warning("Koszyk jest pusty");
        return;
      }

      // Walidacja formularza
      clearFieldErrors(checkoutFormsContainer);

      const email = emailInput.value.trim();
      const name = nameInput?.value.trim() || "";
      const phone = phoneInput?.value.trim() || "";

      // Walidacja checkboxów (obowiązkowe)
      const acceptTermsCheckbox = document.getElementById("accept-terms") as HTMLInputElement | null;
      const acceptPowerOfAttorneyCheckbox = document.getElementById("accept-power-of-attorney") as HTMLInputElement | null;
      const acceptElectronicServiceCheckbox = document.getElementById("accept-electronic-service") as HTMLInputElement | null;

      const checkboxErrors: Record<string, string> = {};
      if (!acceptTermsCheckbox?.checked) {
        checkboxErrors.acceptTerms = "Musisz zaakceptować Regulamin i warunki";
        if (acceptTermsCheckbox) {
          acceptTermsCheckbox.classList.add("field-error");
        }
      }
      if (!acceptPowerOfAttorneyCheckbox?.checked) {
        checkboxErrors.acceptPowerOfAttorney = "Musisz potwierdzić posiadanie pełnomocnictwa";
        if (acceptPowerOfAttorneyCheckbox) {
          acceptPowerOfAttorneyCheckbox.classList.add("field-error");
        }
      }
      if (!acceptElectronicServiceCheckbox?.checked) {
        checkboxErrors.acceptElectronicService = "Musisz wyrazić zgodę na obsługę elektroniczną";
        if (acceptElectronicServiceCheckbox) {
          acceptElectronicServiceCheckbox.classList.add("field-error");
        }
      }

      // Walidacja podstawowych pól
      const validationRules: ValidationRules = {
        customerName: {
          required: true,
          custom: validateName
        },
        customerEmail: {
          required: true,
          custom: validateEmail
        },
        customerPhone: {
          required: true,
          custom: validatePhone
        }
      };

      // Dodatkowa walidacja dla faktury na firmę
      const isCompanyForValidation = invoiceCompanyCheckbox?.checked || false;
      if (isCompanyForValidation) {
        validationRules.companyName = { required: true, minLength: 2, message: "Podaj nazwę firmy" };
        validationRules.companyTaxId = {
          required: true,
          custom: (value) => {
            const digits = value.replace(/\D/g, "");
            if (digits.length !== 10) return "NIP musi mieć 10 cyfr";
            return null;
          }
        };
        validationRules.companyAddress = { required: true, minLength: 5, message: "Podaj adres firmy" };
      }

      const validation = validateForm(checkoutFormsContainer, validationRules);

      // Połącz błędy z checkboxów z błędami z formularza
      const allErrors = { ...validation.errors, ...checkboxErrors };

      if (!validation.isValid || Object.keys(checkboxErrors).length > 0) {
        showFieldErrors(checkoutFormsContainer, allErrors);
        // Pokaż pierwsze pole z błędem (checkboxy lub pola formularza)
        const firstErrorField = checkoutFormsContainer.querySelector(".field-error") as HTMLElement;
        if (firstErrorField) {
          firstErrorField.focus();
          firstErrorField.scrollIntoView({ behavior: "smooth", block: "center" });
        }
        notifications.error("Proszę poprawić błędy w formularzu");
        return;
      }

      // Wykonaj operację z loading state
      await withButtonLoading(
        orderForm,
        async () => {
          // Jeśli mamy sesję z magic linku (zweryfikowaną), użyj jej zamiast tworzyć nową
          // To zapobiega naliczaniu punktów w "starej karcie" bez weryfikacji
          let sessionId: string;
          const currentSessionId = getCurrentSessionId(hasSessionFromMagicLink);
          
          if (hasSessionFromMagicLink && currentSessionId && sessionFromUrl === currentSessionId) {
            // Mamy sesję z magic linku - sprawdź czy jest zweryfikowana i użyj jej
            try {
              const session = await getCheckoutSession(currentSessionId);
              const loyaltyVerified = (session.session as unknown as { loyaltyVerified?: boolean })
                .loyaltyVerified;
              
              // Użyj sesji z magic linku tylko jeśli jest zweryfikowana
              // i email się zgadza (lub wymuś użycie emaila z sesji)
              if (loyaltyVerified) {
                // Jeśli email się nie zgadza, użyj emaila z sesji (magic link jest dla konkretnego emaila)
                const sessionEmail = session.session.customerEmail;
                if (sessionEmail && sessionEmail !== email) {
                  notifications.warning(
                    `Aby użyć Dream Points, użyj adresu email ${sessionEmail} (z magic linku)`
                  );
                  if (emailInput) {
                    emailInput.value = sessionEmail;
                    emailInput.focus();
                  }
                  throw new Error("Email mismatch with magic link session");
                }
                sessionId = currentSessionId;
                // Zsynchronizuj koszyk z sesją (magic link - izolacja)
                const sessionCart = await loadCartFromBackend(sessionId, true);
                await saveCartToBackend(sessionCart, sessionId, true);
              } else {
                // Sesja nie jest zweryfikowana - utwórz nową (bez punktów)
                const currentCart = getCurrentSessionId(false)
                  ? await syncCartWithBackend(getCurrentSessionId(false)!, false)
                  : loadCart();
                sessionId = await ensureCheckoutSessionForEmail(email, currentCart);
              }
            } catch (err) {
              // Jeśli błąd, utwórz nową sesję (bez punktów)
              const currentCart = getCurrentSessionId(false)
                ? await syncCartWithBackend(getCurrentSessionId(false)!, false)
                : loadCart();
              sessionId = await ensureCheckoutSessionForEmail(email, currentCart);
            }
          } else {
            // Brak sesji z magic linku - normalny flow
            const currentCart = getCurrentSessionId(false)
              ? await syncCartWithBackend(getCurrentSessionId(false)!, false)
              : loadCart();
            sessionId = await ensureCheckoutSessionForEmail(email, currentCart);
          }

          // Sprawdź czy sesja jest nadal aktywna przed kontynuowaniem
          const canProceedCheckout = await handleInvalidSession(
            sessionId,
            "kontynuowanie checkoutu"
          );
          if (!canProceedCheckout) {
            throw new Error("Sesja checkoutu nie jest już aktywna");
          }

          // Upewnij się, że UI Dream Points (jeśli dotyczy) jest już załadowane przed złożeniem zamówienia
          // (żeby użytkownik miał realną szansę zaznaczyć checkbox).
          await refreshLoyaltyPointsUi().catch(() => {});

          // Pobierz dane z formularza
          const customerName = nameInput?.value.trim() || "";
          const customerPhone = phoneInput?.value.trim() || "";
          const isCompany = invoiceCompanyCheckbox?.checked || false;
          const invoiceType = isCompany ? "INVOICE_COMPANY" : "RECEIPT";

          const normalizeDocumentNumber = (value: string) =>
            value.replace(/\s+/g, "").replace(/-/g, "").toUpperCase();

          const validateDocumentNumber = (
            value: string,
            documentType: "ID_CARD" | "PASSPORT"
          ): string | null => {
            const normalized = normalizeDocumentNumber(value);
            if (!normalized) return "Numer dokumentu jest wymagany";

            if (documentType === "ID_CARD") {
              // PL dowód: 3 litery + 6 cyfr (np. ABC123456)
              if (!/^[A-Z]{3}\d{6}$/.test(normalized)) {
                return "Numer dowodu powinien mieć format ABC123456";
              }
              return null;
            }

            if (documentType === "PASSPORT") {
              // PL paszport: 2 litery + 7 cyfr (np. AA1234567)
              if (!/^[A-Z]{2}\d{7}$/.test(normalized)) {
                return "Numer paszportu powinien mieć format AA1234567";
              }
              return null;
            }

            // PASSPORT
            return null;
          };

          // Użyj aktualnego koszyka z sesji
          const sessionCart = await loadCartFromBackend(sessionId, hasSessionFromMagicLink);

          // Pobierz dane pasażerów dla każdego wyjazdu osobno
          const items: Array<{
            tripId: string;
            qty: number;
            passengers: Array<{
              firstName: string;
              lastName: string;
              birthDate: string;
              documentType: "ID_CARD" | "PASSPORT";
              documentNumber: string;
            }>;
          }> = [];

          const passengersSection = document.getElementById("passengers-section");
          const passengerErrors: Record<string, string> = {};

          if (passengersSection) {
            clearFieldErrors(passengersSection);
          }

          // Iteruj po wyjazdach w koszyku
          for (let itemIndex = 0; itemIndex < sessionCart.length; itemIndex++) {
            const item = sessionCart[itemIndex];
            if (!item.id) continue;

            // Pobierz trip z API (używamy slug jako tripId)
            let tripId: string;
            try {
              const trip = (await tripsApi.getBySlug(item.id)) as TripFromApi;
              tripId = trip.id; // użyj ID z API
            } catch (err) {
              console.error(`Failed to load trip ${item.id} from API:`, err);
              notifications.error(`Nie udało się załadować wyjazdu "${item.id}". Spróbuj odświeżyć stronę.`);
              throw new Error(`Nie udało się załadować wyjazdu: ${item.id}`);
            }

            // Zbierz dane uczestników dla tego wyjazdu
            const itemPassengers: Array<{
              firstName: string;
              lastName: string;
              birthDate: string;
              documentType: "ID_CARD" | "PASSPORT";
              documentNumber: string;
            }> = [];

            // Zbierz dane uczestników dla tego wyjazdu (używając data-item-index)
            for (let passengerIndex = 0; passengerIndex < item.qty; passengerIndex++) {
              const firstNameInput = document.querySelector<HTMLInputElement>(
                `input[name="item-${itemIndex}-passenger-${passengerIndex}-firstName"]`
              );
              const lastNameInput = document.querySelector<HTMLInputElement>(
                `input[name="item-${itemIndex}-passenger-${passengerIndex}-lastName"]`
              );
              const birthDateInput = document.querySelector<HTMLInputElement>(
                `input[name="item-${itemIndex}-passenger-${passengerIndex}-birthDate"]`
              );
              const documentTypeSelect = document.querySelector<HTMLSelectElement>(
                `select[name="item-${itemIndex}-passenger-${passengerIndex}-documentType"]`
              );
              const documentInput = document.querySelector<HTMLInputElement>(
                `input[name="item-${itemIndex}-passenger-${passengerIndex}-documentNumber"]`
              );

              if (firstNameInput && lastNameInput) {
                itemPassengers.push({
                  firstName: firstNameInput.value.trim(),
                  lastName: lastNameInput.value.trim(),
                  birthDate: birthDateInput?.value || "",
                  documentType:
                    (documentTypeSelect?.value as "ID_CARD" | "PASSPORT") || "ID_CARD",
                  documentNumber: normalizeDocumentNumber(documentInput?.value.trim() || "")
                });

                // Walidacja dla tego uczestnika
                if (!firstNameInput.value.trim()) {
                  passengerErrors[`item-${itemIndex}-passenger-${passengerIndex}-firstName`] = "Imię jest wymagane";
                }

                if (!lastNameInput.value.trim()) {
                  passengerErrors[`item-${itemIndex}-passenger-${passengerIndex}-lastName`] = "Nazwisko jest wymagane";
                }

                // Data urodzenia - wymagana
                if (birthDateInput) {
                  const value = birthDateInput.value.trim();
                  if (!value) {
                    passengerErrors[`item-${itemIndex}-passenger-${passengerIndex}-birthDate`] = "Data urodzenia jest wymagana";
                  } else {
                    const dateError = validateBirthDate(value);
                    if (dateError) {
                      passengerErrors[`item-${itemIndex}-passenger-${passengerIndex}-birthDate`] = dateError;
                    }
                  }
                }

                // Numer dokumentu - wymagany
                if (documentInput) {
                  const value = documentInput.value.trim();
                  const documentType =
                    (documentTypeSelect?.value as "ID_CARD" | "PASSPORT") || "ID_CARD";
                  const docError = validateDocumentNumber(value, documentType);
                  if (docError) {
                    passengerErrors[`item-${itemIndex}-passenger-${passengerIndex}-documentNumber`] = docError;
                  }
                }
              }
            }

            // Sprawdź czy liczba uczestników zgadza się z qty
            if (itemPassengers.length !== item.qty) {
              notifications.error(
                `Liczba uczestników dla wyjazdu "${item.id}" (${itemPassengers.length}) nie zgadza się z ilością (${item.qty})`
              );
              if (passengersSection) {
                passengersSection.scrollIntoView({ behavior: "smooth", block: "center" });
              }
              throw new Error(`Liczba uczestników dla wyjazdu ${item.id} nie zgadza się z ilością`);
            }

            items.push({
              tripId,
              qty: item.qty,
              passengers: itemPassengers
            });
          }

          // Wyświetl błędy walidacji, jeśli istnieją
          if (Object.keys(passengerErrors).length > 0) {
            if (passengersSection) {
              // Pokaż błędy przy polach pasażerów
              for (const [fieldName, errorMessage] of Object.entries(passengerErrors)) {
                const field = document.querySelector<HTMLInputElement | HTMLSelectElement>(
                  `[name="${fieldName}"]`
                );
                if (field) {
                  field.classList.add("field-error");
                  const fieldGroup = field.closest(".field-group");
                  if (fieldGroup) {
                    let errorEl = fieldGroup.querySelector(`#error-${fieldName}`) as HTMLElement;
                    if (!errorEl) {
                      errorEl = document.createElement("div");
                      errorEl.id = `error-${fieldName}`;
                      errorEl.className = "field-error-message";
                      errorEl.setAttribute("role", "alert");
                      fieldGroup.appendChild(errorEl);
                    }
                    errorEl.textContent = errorMessage;
                  }
                }
              }
            }

            notifications.error("Proszę uzupełnić dane wszystkich uczestników");
            if (passengersSection) {
              passengersSection.scrollIntoView({ behavior: "smooth", block: "center" });
            }
            throw new Error("Nieprawidłowe dane uczestników");
          }

          // Sprawdź czy sesja jest nadal aktywna przed finalizacją zamówienia
          const canProceedOrder = await handleInvalidSession(sessionId, "finalizację zamówienia");
          if (!canProceedOrder) {
            throw new Error("Sesja checkoutu nie jest już aktywna");
          }

          // Sprawdź czy użytkownik chce użyć punktów
          // WAŻNE: Punkty można używać TYLKO jeśli sesja jest zweryfikowana magic linkiem
          let usePoints = false;
          if (usePointsCheckbox?.checked) {
            // Sprawdź czy sesja jest zweryfikowana
            try {
              const session = await getCheckoutSession(sessionId);
              const loyaltyVerified = (session.session as unknown as { loyaltyVerified?: boolean })
                .loyaltyVerified;
              if (loyaltyVerified) {
                usePoints = true;
              } else {
                // Sesja nie jest zweryfikowana - nie używaj punktów
                console.warn("Cannot use points: session is not verified via magic link");
                usePoints = false;
              }
            } catch (err) {
              console.error("Failed to verify session for points usage:", err);
              usePoints = false;
            }
          }

          // Utwórz zamówienie
          // UWAGA: Po utworzeniu zamówienia, sesja zostanie oznaczona jako PAID,
          // więc nie waliduj sesji po tym kroku
          const orderResponse = await ordersApi.create({
            checkoutSessionId: sessionId,
            customerName,
            customerEmail: email,
            customerPhone,
            invoiceType: invoiceType as "RECEIPT" | "INVOICE_PERSONAL" | "INVOICE_COMPANY",
            companyName:
              isCompany ? companyNameInput?.value.trim() || null : null,
            companyTaxId:
              isCompany ? companyTaxIdInput?.value.trim() || null : null,
            companyAddress:
              isCompany ? companyAddressInput?.value.trim() || null : null,
            items,
            usePoints
          });

          // Zapisz dane zamówienia lokalnie (na potrzeby ekranu statusu płatności)
          localStorage.setItem(
            "dtsLastOrder",
            JSON.stringify({
              orderId: orderResponse.order.id,
              orderNumber: orderResponse.order.orderNumber,
              customerEmail: email,
              provider:
                (document.querySelector<HTMLInputElement>('input[name="pay"]:checked')?.value as
                  | "PRZELEWY24"
                  | "MANUAL_TRANSFER"
                  | undefined) || "MANUAL_TRANSFER",
              createdAt: new Date().toISOString()
            })
          );

          // Inicjalizuj płatność (nie parsuj tekstu z labela - użyj value z inputa)
          const provider =
            (document.querySelector<HTMLInputElement>('input[name="pay"]:checked')?.value as
              | "PRZELEWY24"
              | "MANUAL_TRANSFER"
              | undefined) || "MANUAL_TRANSFER";

          let paymentResponse:
            | {
                redirectUrl?: string;
                message?: string;
              }
            | undefined;

          try {
            paymentResponse = await paymentsApi.create(orderResponse.order.id, provider);
          } catch (paymentErr) {
            console.error("Payment initialization failed:", paymentErr);
            notifications.error(
              paymentErr instanceof Error
                ? paymentErr.message
                : "Nie udało się zainicjalizować płatności."
            );

            // Nawet jeśli init płatności nie wyszedł, zamówienie już istnieje - pokaż ekran statusu,
            // na którym użytkownik może wznowić płatność.
            // Wyczyść koszyk i sesję (magic link lub normalna)
            // WAŻNE: Czyścimy localStorage zawsze, bo może zawierać stary koszyk z wcześniejszej sesji
            saveCart([]);
            setCurrentSessionId(null, hasSessionFromMagicLink);
            window.location.href = `platnosc.html?order=${encodeURIComponent(
              orderResponse.order.orderNumber
            )}`;
            return;
          }

          // Wyczyść koszyk i sesję po utworzeniu zamówienia (żeby uniknąć dubli / pomyłek po powrocie)
          // WAŻNE: Czyścimy localStorage zawsze, bo może zawierać stary koszyk z wcześniejszej sesji
          // (np. użytkownik miał koszyk w localStorage, złożył zamówienie przez magic link,
          // a potem wraca na stronę bez parametru session - wtedy frontend użyje localStorage)
          saveCart([]);
          setCurrentSessionId(null, hasSessionFromMagicLink);

          if (paymentResponse?.redirectUrl) {
            // Redirect do P24
            window.location.href = paymentResponse.redirectUrl;
            return;
          }

          // Przelew tradycyjny (lub brak redirectu) - przenieś na ekran statusu/instrukcji
          window.location.href = `platnosc.html?order=${encodeURIComponent(
            orderResponse.order.orderNumber
          )}`;
        },
        "Przetwarzanie zamówienia..."
      ).catch((err) => {
        console.error("Order creation failed:", err);
        let errorMessage = "Wystąpił błąd podczas składania rezerwacji. Spróbuj ponownie.";

        if (err instanceof Error) {
          // Sprawdź czy to błąd z API (ma strukturę z details)
          if ("details" in err) {
            const details = (err as Error & { details?: Array<{ message: string }> }).details;
            if (details && Array.isArray(details) && details.length > 0) {
              errorMessage = details.map((d) => d.message).join(", ");
            } else if (err.message) {
              errorMessage = err.message;
            }
          } else if (err.message) {
            errorMessage = err.message;
          }
        }

        notifications.error(errorMessage);
      });
    });
  }
}

// Fallback: jeśli API nie działa, użyj starej wersji
if (import.meta.env.VITE_API_URL || window.location.hostname === "localhost") {
  initCartPage().catch((err) => {
    console.warn("API integration failed, using legacy cart:", err);
    initCartPageLegacy().catch(console.error);
  });
} else {
  initCartPageLegacy().catch(console.error);
}
