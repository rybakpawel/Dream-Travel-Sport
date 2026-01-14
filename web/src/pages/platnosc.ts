import { ordersApi, paymentsApi } from "../api/client.js";
import { saveCart } from "../features/cart/storage.js";
import { setCurrentSessionId } from "../features/checkout/session.js";
import { setButtonLoading } from "../utils/loading.js";
import { notifications } from "../utils/notifications.js";

type LookupResponse = {
  success: boolean;
  order: {
    id: string;
    orderNumber: string;
    status: string;
    totalCents: number;
    currency: string;
    submittedAt: string;
  };
  payment:
    | {
        id: string;
        provider: string;
        status: string;
        createdAt: string;
        paidAt: string | null;
      }
    | null;
  manualTransfer:
    | {
        bankAccount: string | null;
        title: string;
        amountCents: number;
        currency: string;
      }
    | null;
};

const LAST_ORDER_KEY = "dtsLastOrder";
type LastOrder = {
  orderId: string;
  orderNumber: string;
  customerEmail: string;
  provider: "PRZELEWY24" | "MANUAL_TRANSFER";
  createdAt: string;
};

function formatMoney(cents: number, currency: string) {
  const value = cents / 100;
  const formatted = value.toLocaleString("pl-PL", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  return `${formatted} ${currency === "PLN" ? "zł" : currency}`;
}

function clearCheckoutClientState() {
  // Wyzeruj koszyk w localStorage
  saveCart([]);
  // Wyczyść checkout session (w pamięci i w localStorage, jeśli ktoś je przechowuje)
  setCurrentSessionId(null);
  localStorage.removeItem("checkoutSessionId");
}

function readLastOrder(): LastOrder | null {
  try {
    const raw = localStorage.getItem(LAST_ORDER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const obj = parsed as Record<string, unknown>;
    if (
      typeof obj.orderId !== "string" ||
      typeof obj.orderNumber !== "string" ||
      typeof obj.customerEmail !== "string" ||
      typeof obj.provider !== "string" ||
      typeof obj.createdAt !== "string"
    ) {
      return null;
    }
    return obj as LastOrder;
  } catch {
    return null;
  }
}

function setText(id: string, value: string) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function show(id: string, visible: boolean) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.display = visible ? "" : "none";
}

function normalizeOrderNumberFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  // My ustawiamy ?order=..., ale część integracji P24 potrafi dodać sessionId
  return (
    params.get("order") ||
    params.get("sessionId") ||
    params.get("p24_session_id") ||
    params.get("p24_sessionId")
  );
}

async function lookup(orderNumber: string, email: string): Promise<LookupResponse> {
  return (await ordersApi.lookup({ orderNumber, customerEmail: email })) as LookupResponse;
}

function decideTitle(data: LookupResponse) {
  const payment = data.payment;
  const isPaid = payment?.status === "PAID" || data.order.status === "CONFIRMED";

  if (isPaid) {
    return {
      title: "Płatność potwierdzona",
      subtitle:
        "Dziękujemy! Twoje zamówienie zostało opłacone. Potwierdzenie wyślemy również mailowo."
    };
  }

  if (payment?.provider === "MANUAL_TRANSFER") {
    return {
      title: "Rezerwacja złożona",
      subtitle: "Czekamy na przelew tradycyjny. Poniżej znajdziesz instrukcję płatności."
    };
  }

  if (payment?.provider === "PRZELEWY24") {
    if (payment.status === "FAILED" || payment.status === "CANCELLED") {
      return {
        title: "Płatność nieudana",
        subtitle:
          "Nie udało się zrealizować płatności. Możesz spróbować ponownie klikając „Wznów płatność”."
      };
    }

    if (payment.status === "PENDING") {
      const createdAt = new Date(payment.createdAt).getTime();
      const ageMinutes = Number.isFinite(createdAt) ? (Date.now() - createdAt) / 60000 : 0;

      // timeLimit w P24 ustawiamy na 15 minut. Po tym czasie bardzo często oznacza to brak wpłaty.
      if (ageMinutes >= 16) {
        return {
          title: "Nie odnotowaliśmy wpłaty",
          subtitle:
            "Wygląda na to, że płatność nie została zakończona w czasie. Możesz spróbować ponownie lub odświeżyć status."
        };
      }
    }

    return {
      title: "Oczekujemy na potwierdzenie płatności",
      subtitle:
        "Jeśli płatność została wykonana, potwierdzenie może zająć chwilę. Możesz odświeżyć status lub wznowić płatność."
    };
  }

  return {
    title: "Sprawdzamy status zamówienia…",
    subtitle: "Jeśli coś poszło nie tak, spróbuj odświeżyć status lub wrócić do koszyka."
  };
}

const ORDER_STATUS_LABEL: Record<string, string> = {
  DRAFT: "Szkic",
  SUBMITTED: "Złożone",
  CONFIRMED: "Potwierdzone",
  CANCELLED: "Anulowane"
};

const PAYMENT_STATUS_LABEL: Record<string, string> = {
  PENDING: "Oczekuje",
  PAID: "Opłacona",
  FAILED: "Nieudana",
  CANCELLED: "Anulowana",
  REFUNDED: "Zwrócona"
};

const PAYMENT_PROVIDER_LABEL: Record<string, string> = {
  PRZELEWY24: "Przelewy24",
  MANUAL_TRANSFER: "Przelew tradycyjny"
};

async function init() {
  const orderNumber = normalizeOrderNumberFromUrl();
  if (!orderNumber) {
    setText("status-title", "Brakuje numeru zamówienia");
    setText(
      "status-subtitle",
      "Wejdź do koszyka i spróbuj ponownie lub skontaktuj się z nami, jeśli problem się powtarza."
    );
    show("back-to-cart", true);
    return;
  }

  setText("order-number", orderNumber);

  const refreshBtn = document.getElementById("refresh-status") as HTMLButtonElement | null;
  const retryBtn = document.getElementById("retry-payment") as HTMLButtonElement | null;
  const emailCard = document.getElementById("email-card");
  const emailInput = document.getElementById("email-input") as HTMLInputElement | null;
  const emailSubmit = document.getElementById("email-submit") as HTMLButtonElement | null;

  let currentEmail = "";
  let preferredProvider: "PRZELEWY24" | "MANUAL_TRANSFER" | null = null;
  let latest: LookupResponse | null = null;
  let pollTimer: number | null = null;
  let isLoading = false;

  const stopPolling = () => {
    if (pollTimer) {
      window.clearInterval(pollTimer);
      pollTimer = null;
    }
  };

  const startPolling = () => {
    stopPolling();
    // Polluj przez pierwsze ~60s (webhook może dojść z opóźnieniem)
    const startedAt = Date.now();
    pollTimer = window.setInterval(async () => {
      if (Date.now() - startedAt > 60_000) {
        stopPolling();
        return;
      }
      await refresh(false);
    }, 2500);
  };

  const applyState = (data: LookupResponse) => {
    const payment = data.payment;
    const isPaid = payment?.status === "PAID" || data.order.status === "CONFIRMED";

    setText("order-status", ORDER_STATUS_LABEL[data.order.status] || data.order.status);

    const providerLabel = payment ? PAYMENT_PROVIDER_LABEL[payment.provider] || payment.provider : "";
    const statusLabel = payment ? PAYMENT_STATUS_LABEL[payment.status] || payment.status : "";
    setText("payment-status", payment ? `${providerLabel} • ${statusLabel}` : "—");

    const title = decideTitle(data);
    setText("status-title", title.title);
    setText("status-subtitle", title.subtitle);

    // Manual transfer UI
    if (data.manualTransfer) {
      show("manual-transfer", true);
      setText("transfer-amount", formatMoney(data.manualTransfer.amountCents, data.manualTransfer.currency));
      setText("transfer-title", data.manualTransfer.title);
      setText("transfer-account", data.manualTransfer.bankAccount || "—");
      show("transfer-account-hint", !data.manualTransfer.bankAccount);
    } else {
      show("manual-transfer", false);
    }

    // Actions
    if (retryBtn) {
      // Retry sens ma tylko dla P24 i gdy nie jest PAID
      const providerForRetry = payment?.provider || preferredProvider;
      const canRetry = !isPaid && providerForRetry === "PRZELEWY24";
      retryBtn.style.display = canRetry ? "" : "none";
    }

    // Po potwierdzeniu płatności czyścimy koszyk i sesję (gdyby użytkownik wrócił na koszyk)
    if (isPaid) {
      clearCheckoutClientState();
      stopPolling();
    }
  };

  const refresh = async (showToastOnError: boolean) => {
    if (isLoading) return;
    if (!currentEmail) {
      show("email-card", true);
      show("back-to-cart", true);
      return;
    }

    isLoading = true;
    try {
      latest = await lookup(orderNumber, currentEmail);
      applyState(latest);
    } catch (err) {
      if (showToastOnError) {
        const msg = err instanceof Error ? err.message : "Nie udało się pobrać statusu zamówienia.";
        notifications.error(msg);
      }
      // W razie błędu pokaż formularz emaila (częsty przypadek: inny email / brak danych)
      show("email-card", true);
      show("back-to-cart", true);
    } finally {
      isLoading = false;
    }
  };

  const initEmail = () => {
    const last = readLastOrder();
    if (last && last.orderNumber === orderNumber) {
      currentEmail = last.customerEmail;
      preferredProvider = last.provider;
      show("email-card", false);
      return;
    }
    // Jeśli nie mamy emaila – pokaż input
    show("email-card", true);
  };

  initEmail();

  if (refreshBtn) {
    refreshBtn.addEventListener("click", async () => {
      await refresh(true);
    });
  }

  if (emailSubmit && emailInput) {
    emailSubmit.addEventListener("click", async () => {
      const email = emailInput.value.trim();
      if (!email) {
        notifications.warning("Wpisz adres e-mail");
        return;
      }
      currentEmail = email;
      show("email-card", false);
      await refresh(true);
      startPolling();
    });
  }

  if (retryBtn) {
    retryBtn.addEventListener("click", async () => {
      if (!latest) {
        await refresh(true);
      }
      if (!latest) return;

      // Nie retry jeśli już PAID
      const isPaid = latest.payment?.status === "PAID" || latest.order.status === "CONFIRMED";
      if (isPaid) {
        notifications.info("Płatność jest już potwierdzona.");
        return;
      }

      try {
        setButtonLoading(retryBtn, true, "Wznawianie płatności…");
        const resp = await paymentsApi.create(latest.order.id, "PRZELEWY24", { forceNew: true });
        if (resp.redirectUrl) {
          window.location.href = resp.redirectUrl;
          return;
        }
        notifications.error("Nie udało się wznowić płatności.");
      } catch (err) {
        notifications.error(err instanceof Error ? err.message : "Nie udało się wznowić płatności.");
      } finally {
        setButtonLoading(retryBtn, false);
      }
    });
  }

  // Pierwsze odświeżenie + polling
  await refresh(false);
  startPolling();
}

init().catch((err) => {
  console.error("[platnosc] init failed:", err);
  notifications.error("Nie udało się uruchomić ekranu płatności.");
});


