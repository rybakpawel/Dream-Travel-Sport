import { adminApi } from "../api/client.js";
import { notifications } from "../utils/notifications.js";
import { showLoading, hideLoading, setButtonLoading } from "../utils/loading.js";
import { showFieldErrors, clearFieldErrors } from "../utils/form-validation.js";

const ADMIN_TOKEN_KEY = "adminToken";

// Etykiety (UI-friendly) dla enumów z backendu
const ORDER_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Szkic",
  SUBMITTED: "Złożone",
  CONFIRMED: "Potwierdzone",
  CANCELLED: "Anulowane"
};

const PAYMENT_PROVIDER_LABELS: Record<string, string> = {
  PRZELEWY24: "Przelewy24",
  MANUAL_TRANSFER: "Przelew tradycyjny"
};

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  PENDING: "Oczekuje",
  PAID: "Opłacona",
  FAILED: "Nieudana",
  CANCELLED: "Anulowana",
  REFUNDED: "Zwrócona"
};

const NEWSLETTER_STATUS_LABELS: Record<string, string> = {
  PENDING: "Oczekujące",
  CONFIRMED: "Potwierdzone",
  UNSUBSCRIBED: "Wypisane"
};

const TRIP_AVAILABILITY_LABELS: Record<string, string> = {
  OPEN: "Dostępny",
  WAITLIST: "Lista oczekujących",
  CLOSED: "Brak miejsc"
};

function labelFrom(map: Record<string, string>, value: unknown): string {
  const key = typeof value === "string" ? value : "";
  return map[key] || (typeof value === "string" ? value : "-");
}

// State
let currentToken: string | null = null;
let currentTab = "orders";
let currentContentSubpage = "home";
let currentPage: Record<string, number> = {
  orders: 1,
  trips: 1,
  users: 1,
  newsletter: 1
};
let showOverdueManualTransfers = false;
let overdueManualTransfersCount = 0;
let overdueManualTransfersHours = 48;

// DOM Elements - sprawdź czy są dostępne
const loginSection = document.getElementById("login-section");
const dashboardSection = document.getElementById("dashboard-section");
const loginForm = document.getElementById("login-form") as HTMLFormElement | null;
const logoutBtn = document.getElementById("logout-btn") as HTMLButtonElement | null;

if (!loginSection || !dashboardSection || !loginForm || !logoutBtn) {
  console.error("[admin] Required DOM elements not found");
  throw new Error("Required DOM elements not found");
}

// Check if already logged in
function checkAuth() {
  const token = localStorage.getItem(ADMIN_TOKEN_KEY);
  if (token) {
    currentToken = token;
    showDashboard();
  } else {
    showLogin();
  }
}

function showLogin() {
  loginSection!.style.display = "block";
  dashboardSection!.style.display = "none";
}

function showDashboard() {
  loginSection!.style.display = "none";
  dashboardSection!.style.display = "block";
  loadStats();
  loadTab(currentTab);

  // Ustaw listenery dla przycisków w zakładce trips po pokazaniu dashboardu
  setTimeout(() => {
    setupTripModalListeners();
  }, 100);
}

// Login
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const formData = new FormData(loginForm);
  const token = formData.get("token") as string;

  if (!token) {
    notifications.error("Podaj token administracyjny");
    return;
  }

  try {
    showLoading(loginForm);
    // Test token by fetching stats
    await adminApi.getStats(token);
    // Token is valid
    currentToken = token;
    localStorage.setItem(ADMIN_TOKEN_KEY, token);
    showDashboard();
    notifications.success("Zalogowano pomyślnie");
  } catch (err) {
    notifications.error("Nieprawidłowy token");
    console.error("Login error:", err);
  } finally {
    hideLoading(loginForm);
  }
});

// Logout
logoutBtn.addEventListener("click", () => {
  currentToken = null;
  localStorage.removeItem(ADMIN_TOKEN_KEY);
  showLogin();
  notifications.info("Wylogowano");
});

// Load Stats
async function loadStats() {
  if (!currentToken) return;

  try {
    const stats = await adminApi.getStats(currentToken);

    document.getElementById("stat-trips")!.textContent = String(stats.trips.total);
    document.getElementById("stat-orders")!.textContent = String(stats.orders.total);
    document.getElementById("stat-users")!.textContent = String(stats.users.total);
    document.getElementById("stat-newsletter")!.textContent = String(stats.newsletter.subscribers);
    document.getElementById("stat-revenue")!.textContent =
      `${(stats.revenue.totalCents / 100).toLocaleString("pl-PL")} zł`;
    document.getElementById("stat-pending")!.textContent = String(stats.orders.pending);

    overdueManualTransfersCount = stats.orders.overdueManualTransfers ?? 0;
    overdueManualTransfersHours = stats.orders.overdueManualTransfersHours ?? 48;

    const overdueBtn = document.getElementById("orders-overdue-manual-btn") as HTMLButtonElement | null;
    if (overdueBtn) {
      overdueBtn.textContent =
        overdueManualTransfersCount > 0
          ? `Zaległe rezerwacje (${overdueManualTransfersCount})`
          : "Zaległe rezerwacje";
      overdueBtn.disabled = overdueManualTransfersCount <= 0 && !showOverdueManualTransfers;
    }
  } catch (err) {
    notifications.error("Nie udało się załadować statystyk");
    console.error("Stats error:", err);
  }
}

// Tabs
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const tab = btn.getAttribute("data-tab");
    if (!tab) return;

    // Update active tab
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");

    // Update active content
    document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
    document.getElementById(`tab-${tab}`)?.classList.add("active");

    currentTab = tab;
    loadTab(tab);
  });
});

// Load Tab Content
async function loadTab(tab: string) {
  if (!currentToken) return;

  switch (tab) {
    case "orders":
      await loadOrders();
      break;
    case "trips":
      await loadTrips();
      // Ustaw listenery dla przycisku "Dodaj wyjazd" po załadowaniu zakładki
      // (jeśli jeszcze nie są ustawione)
      setTimeout(() => {
        setupTripModalListeners();
      }, 100);
      break;
    case "users":
      await loadUsers();
      break;
    case "newsletter":
      await loadNewsletter();
      break;
    case "content":
      await loadContent();
      break;
  }
}

// Load Orders
async function loadOrders(page = 1) {
  if (!currentToken) return;

  const container = document.getElementById("orders-table-container");
  if (!container) return;

  const statusFilterElement = document.getElementById("orders-status-filter") as HTMLSelectElement;
  const statusFilter =
    statusFilterElement?.value && statusFilterElement.value.trim() !== ""
      ? statusFilterElement.value
      : undefined;

  try {
    showLoading(container);
    const response = await adminApi.getOrders(
      currentToken,
      page,
      50,
      showOverdueManualTransfers ? undefined : statusFilter,
      showOverdueManualTransfers
    );

    // Sprawdź czy odpowiedź ma poprawną strukturę
    if (!response || !response.data || !response.pagination) {
      console.error("Invalid response structure:", response);
      throw new Error("Invalid response structure");
    }

    hideLoading(container);
    renderOrdersTable(response.data as any[], response.pagination);
    currentPage.orders = page;

    // UX: gdy pokazujemy zaległe, wyłącz dropdown statusów
    if (statusFilterElement) {
      statusFilterElement.disabled = showOverdueManualTransfers;
      if (showOverdueManualTransfers) statusFilterElement.value = "";
    }
  } catch (err) {
    hideLoading(container);
    notifications.error("Nie udało się załadować zamówień");
    console.error("Orders error:", err);
    container.innerHTML =
      "<p style='color: var(--dt-muted); text-align: center; padding: 40px;'>Nie udało się załadować danych. Sprawdź konsolę przeglądarki.</p>";
  }
}

async function loadOrderDetails(orderId: string, container: HTMLElement) {
  if (!currentToken) return;

  try {
    const order = await adminApi.getOrder(currentToken, orderId);
    renderOrderDetails(order as any, container);
  } catch (err) {
    console.error("Failed to load order details:", err);
    container.innerHTML = `
      <div style="padding: 20px; color: var(--dt-muted); text-align: center;">
        Nie udało się załadować szczegółów zamówienia.
      </div>
    `;
  }
}

function renderOrderDetails(order: any, container: HTMLElement) {
  const invoiceTypeLabels: Record<string, string> = {
    RECEIPT: "Paragon",
    INVOICE_PERSONAL: "Faktura osobista",
    INVOICE_COMPANY: "Faktura firmowa"
  };

  const documentTypeLabels: Record<string, string> = {
    ID_CARD: "Dowód osobisty",
    PASSPORT: "Paszport",
    OTHER: "Inny"
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleString("pl-PL");
  };

  const formatDateOnly = (dateStr: string | null) => {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleDateString("pl-PL");
  };

  const formatMoney = (cents: number) => {
    return `${(cents / 100).toLocaleString("pl-PL")} ${order.currency || "PLN"}`;
  };

  container.innerHTML = `
    <div class="order-details-grid">
      <div class="order-details-section">
        <h3>Dane klienta</h3>
        <div class="order-details-field">
          <strong>Imię i nazwisko:</strong> ${order.customerName || "-"}
        </div>
        <div class="order-details-field">
          <strong>Email:</strong> ${order.customerEmail}
        </div>
        <div class="order-details-field">
          <strong>Telefon:</strong> ${order.customerPhone || "-"}
        </div>
        ${order.user ? `
          <div class="order-details-field">
            <strong>Konto użytkownika:</strong> ${order.user.email} (utworzone: ${formatDate(order.user.createdAt)})
          </div>
        ` : ""}
      </div>

      <div class="order-details-section">
        <h3>Faktura/Paragon</h3>
        <div class="order-details-field">
          <strong>Typ:</strong> ${labelFrom(invoiceTypeLabels, order.invoiceType)}
        </div>
        ${order.invoiceType === "INVOICE_COMPANY" ? `
          <div class="order-details-field">
            <strong>Nazwa firmy:</strong> ${order.companyName || "-"}
          </div>
          <div class="order-details-field">
            <strong>NIP:</strong> ${order.companyTaxId || "-"}
          </div>
          <div class="order-details-field">
            <strong>Adres:</strong> ${order.companyAddress || "-"}
          </div>
        ` : ""}
      </div>

      <div class="order-details-section">
        <h3>Zamówienie</h3>
        <div class="order-details-field">
          <strong>Numer zamówienia:</strong> ${order.orderNumber}
        </div>
        <div class="order-details-field">
          <strong>Status:</strong> <span class="status-badge ${order.status}">${labelFrom(ORDER_STATUS_LABELS, order.status)}</span>
        </div>
        <div class="order-details-field">
          <strong>Kwota całkowita:</strong> ${formatMoney(order.totalCents)}
        </div>
        <div class="order-details-field">
          <strong>Data złożenia:</strong> ${formatDate(order.submittedAt)}
        </div>
        <div class="order-details-field">
          <strong>Utworzone:</strong> ${formatDate(order.createdAt)}
        </div>
        <div class="order-details-field">
          <strong>Zaktualizowane:</strong> ${formatDate(order.updatedAt)}
        </div>
        ${order.checkoutSession ? `
          <div class="order-details-field">
            <strong>Sesja checkout:</strong> ${order.checkoutSession.id}
            ${order.checkoutSession.pointsReserved ? ` (użyto ${order.checkoutSession.pointsReserved} punktów)` : ""}
          </div>
        ` : ""}
      </div>

      <div class="order-details-section">
        <h3>Płatności</h3>
        ${order.payments && order.payments.length > 0 ? `
          ${order.payments.map((payment: any, index: number) => `
            <div class="order-details-field" style="${index > 0 ? 'margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--dt-border);' : ''}">
              <strong>Dostawca:</strong> ${labelFrom(PAYMENT_PROVIDER_LABELS, payment.provider)}
            </div>
            <div class="order-details-field">
              <strong>Status:</strong> <span class="status-badge ${payment.status}">${labelFrom(PAYMENT_STATUS_LABELS, payment.status)}</span>
            </div>
            <div class="order-details-field">
              <strong>Kwota:</strong> ${formatMoney(payment.amountCents)}
            </div>
            <div class="order-details-field">
              <strong>Data płatności:</strong> ${payment.paidAt ? formatDate(payment.paidAt) : "-"}
            </div>
            ${payment.externalId ? `
              <div class="order-details-field">
                <strong>ID zewnętrzne:</strong> ${payment.externalId}
              </div>
            ` : ""}
          `).join("")}
        ` : "<p style='color: var(--dt-muted);'>Brak płatności</p>"}
      </div>

      <div class="order-details-section order-details-section-full">
        <h3>Pozycje zamówienia</h3>
        ${order.items && order.items.length > 0 ? `
          ${order.items.map((item: any, index: number) => `
            <div class="order-item-details">
              <h4>Pozycja ${index + 1}: ${item.trip.name}</h4>
              <div class="order-details-field">
                <strong>Liczba osób:</strong> ${item.qty}
              </div>
              <div class="order-details-field">
                <strong>Cena za osobę:</strong> ${formatMoney(item.unitPriceCents)}
              </div>
              <div class="order-details-field">
                <strong>Cena całkowita:</strong> ${formatMoney(item.unitPriceCents * item.qty)}
              </div>
              ${item.departurePoint ? `
                <div class="order-details-field">
                  <strong>Miejsce wylotu:</strong> ${item.departurePoint.city}
                </div>
              ` : ""}
              <div class="order-details-field">
                <strong>Uczestnicy:</strong>
                <table class="order-details-table" style="margin-top: 8px;">
                  <thead>
                    <tr>
                      <th>Imię</th>
                      <th>Nazwisko</th>
                      <th>Data urodzenia</th>
                      <th>Typ dokumentu</th>
                      <th>Numer dokumentu</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${item.passengers && item.passengers.length > 0 ? item.passengers.map((passenger: any) => `
                      <tr>
                        <td>${passenger.firstName}</td>
                        <td>${passenger.lastName}</td>
                        <td>${passenger.birthDate ? formatDateOnly(passenger.birthDate) : "-"}</td>
                        <td>${labelFrom(documentTypeLabels, passenger.documentType)}</td>
                        <td>${passenger.documentNumber || "-"}</td>
                      </tr>
                    `).join("") : "<tr><td colspan='5'>Brak uczestników</td></tr>"}
                  </tbody>
                </table>
              </div>
            </div>
          `).join("")}
        ` : "<p style='color: var(--dt-muted);'>Brak pozycji</p>"}
      </div>
    </div>
  `;
}

function renderOrdersTable(orders: any[], pagination: any) {
  const container = document.getElementById("orders-table-container")!;

  if (orders.length === 0) {
    container.innerHTML =
      "<p style='color: var(--dt-muted); text-align: center; padding: 40px;'>Brak zamówień</p>";
    return;
  }

  const table = document.createElement("table");
  table.innerHTML = `
    <thead>
      <tr>
        <th>Numer</th>
        <th>Status</th>
        <th>Klient</th>
        <th>Email</th>
        <th>Kwota</th>
        <th>Data</th>
        <th>Płatność</th>
        <th>Akcje</th>
      </tr>
    </thead>
    <tbody>
      ${orders
        .map((order) => {
          const payments = Array.isArray(order.payments) ? order.payments : [];
          const paidPayment = payments.find((p) => p?.status === "PAID");
          const manualPayment = payments.find((p) => p?.provider === "MANUAL_TRANSFER");
          const payment = paidPayment || manualPayment || payments[0];

          const isManualTransfer = Boolean(manualPayment);
          const canEditManual =
            isManualTransfer &&
            order.status === "SUBMITTED" &&
            payment &&
            payment.status !== "PAID";
          return `
          <tr class="order-row" data-order-id="${order.id}" style="cursor: pointer;">
            <td>${order.orderNumber}</td>
            <td><span class="status-badge ${order.status}">${labelFrom(ORDER_STATUS_LABELS, order.status)}</span></td>
            <td>${order.customerName || "-"}</td>
            <td>${order.customerEmail}</td>
            <td>${(order.totalCents / 100).toLocaleString("pl-PL")} ${order.currency}</td>
            <td>${new Date(order.submittedAt).toLocaleDateString("pl-PL")}</td>
            <td>${
              payment
                ? `<span class="status-badge ${payment.status}">${labelFrom(
                    PAYMENT_PROVIDER_LABELS,
                    payment.provider
                  )} • ${labelFrom(PAYMENT_STATUS_LABELS, payment.status)}</span>`
                : "-"
            }</td>
            <td class="order-actions-cell" onclick="event.stopPropagation();">
              ${
                canEditManual
                  ? `
                    <button class="btn-edit btn-mark-paid" data-order-id="${order.id}">Zaksięguj</button>
                    <button class="btn-delete btn-cancel-order" data-order-id="${order.id}">Anuluj</button>
                  `
                  : "-"
              }
            </td>
          </tr>
          <tr class="order-details-row" data-order-id="${order.id}" style="display: none;">
            <td colspan="8" class="order-details-cell">
              <div class="order-details-content">
                <div class="order-details-loading">Ładowanie szczegółów...</div>
              </div>
            </td>
          </tr>
        `;
        })
        .join("")}
    </tbody>
  `;
  container.innerHTML = "";
  container.appendChild(table);

  // Obsługa kliknięcia w wiersz zamówienia - rozwinięcie szczegółów
  const expandedOrders = new Set<string>();
  table.querySelectorAll(".order-row").forEach((row) => {
    row.addEventListener("click", async (e) => {
      const target = e.target as HTMLElement;
      // Nie rozwijaj jeśli kliknięto w przyciski akcji
      if (target.closest(".order-actions-cell")) return;
      
      const orderId = (row as HTMLElement).getAttribute("data-order-id");
      if (!orderId) return;

      const detailsRow = table.querySelector(`.order-details-row[data-order-id="${orderId}"]`) as HTMLElement;
      if (!detailsRow) return;

      if (expandedOrders.has(orderId)) {
        // Zwiń
        detailsRow.style.display = "none";
        expandedOrders.delete(orderId);
        row.classList.remove("expanded");
      } else {
        // Rozwiń
        detailsRow.style.display = "";
        expandedOrders.add(orderId);
        row.classList.add("expanded");
        
        // Załaduj szczegóły jeśli jeszcze nie załadowane
        const detailsContent = detailsRow.querySelector(".order-details-content");
        if (detailsContent && detailsContent.querySelector(".order-details-loading")) {
          await loadOrderDetails(orderId, detailsContent);
        }
      }
    });
  });

  // Akcje dla przelewu tradycyjnego
  table.querySelectorAll(".btn-mark-paid").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const orderId = (btn as HTMLElement).getAttribute("data-order-id");
      if (!orderId || !currentToken) return;
      if (!confirm("Zaksięgować przelew tradycyjny i oznaczyć zamówienie jako POTWIERDZONE?")) {
        return;
      }

      try {
        await adminApi.markManualTransferPaid(currentToken, orderId);
        notifications.success("Przelew został zaksięgowany");
        await loadOrders(currentPage.orders);
        await loadStats();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Nie udało się zaksięgować przelewu";
        notifications.error(msg);
      }
    });
  });

  table.querySelectorAll(".btn-cancel-order").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const orderId = (btn as HTMLElement).getAttribute("data-order-id");
      if (!orderId || !currentToken) return;
      if (!confirm("Anulować zamówienie i zwolnić miejsca?")) {
        return;
      }

      try {
        await adminApi.cancelManualTransferOrder(currentToken, orderId);
        notifications.success("Zamówienie zostało anulowane");
        await loadOrders(currentPage.orders);
        await loadStats();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Nie udało się anulować zamówienia";
        notifications.error(msg);
      }
    });
  });

  renderPagination("orders-pagination", pagination, loadOrders);
}

// Load Trips
async function loadTrips(page = 1) {
  if (!currentToken) return;

  const container = document.getElementById("trips-table-container");
  if (!container) return;

  try {
    showLoading(container);
    const response = await adminApi.getTrips(currentToken, page, 50);

    // Sprawdź czy odpowiedź ma poprawną strukturę
    if (!response || !response.data || !response.pagination) {
      console.error("Invalid response structure:", response);
      throw new Error("Invalid response structure");
    }

    hideLoading(container);
    renderTripsTable(response.data as any[], response.pagination);
    currentPage.trips = page;
  } catch (err) {
    hideLoading(container);
    notifications.error("Nie udało się załadować wyjazdów");
    console.error("Trips error:", err);
    container.innerHTML =
      "<p style='color: var(--dt-muted); text-align: center; padding: 40px;'>Nie udało się załadować danych. Sprawdź konsolę przeglądarki.</p>";
  }
}

// Trip Modal and CRUD functions (must be defined before renderTripsTable)
let currentEditingTripId: string | null = null;
let currentEditingTripHotelClass: number | null = null;
let extendedDescriptionQuill: any = null; // Quill editor instance

function openTripModal(tripId?: string) {
  currentEditingTripId = tripId || null;
  const modal = document.getElementById("trip-modal");
  const form = document.getElementById("trip-form") as HTMLFormElement;

  if (!modal || !form) {
    console.error("Modal or form not found", { modal: !!modal, form: !!form });
    return;
  }

  console.log("Opening trip modal", { tripId });

  if (tripId) {
    // Edycja - załaduj dane
    loadTripForEdit(tripId);
    (modal.querySelector(".modal-title") as HTMLElement).textContent = "Edytuj wyjazd";
  } else {
    // Nowy wyjazd - wyczyść formularz
    form.reset();
    currentEditingTripId = null;
    currentEditingTripHotelClass = null;
    (modal.querySelector(".modal-title") as HTMLElement).textContent = "Dodaj wyjazd";
    
    // Wyczyść Quill editor
    if (extendedDescriptionQuill) {
      extendedDescriptionQuill.root.innerHTML = "";
      const hiddenInput = document.getElementById("trip-extended-description") as HTMLInputElement;
      if (hiddenInput) {
        hiddenInput.value = "";
      }
    }
    
    // Wyczyść miejsca wylotu dla nowego wyjazdu
    renderDeparturePoints([]);
    
    // Wyczyść klasę hotelu
    setHotelClassStars(null);
  }

  // Wyczyść błędy walidacji przy otwieraniu modala
  clearFieldErrors(form);

  // Inicjalizuj Quill editor dla extendedDescription (jeśli jeszcze nie istnieje)
  initExtendedDescriptionEditor();

  // Ustaw listenery dla miejsc wylotu
  setupDeparturePointsListeners();

  // Inicjalizuj gwiazdki klasy hotelu
  setupHotelClassStars();

  modal.style.display = "flex";
  
  // Ustaw pozycjonowanie tooltipów po otwarciu modala
  setTimeout(() => {
    setupTooltipPositioning();
  }, 0);
}

// Inicjalizuj Quill editor dla pola extendedDescription
function initExtendedDescriptionEditor() {
  const editorContainer = document.getElementById("trip-extended-description-editor");
  if (!editorContainer) return;

  // Jeśli editor już istnieje, nie tworz nowego
  if (extendedDescriptionQuill) {
    return;
  }

  // Sprawdź czy Quill jest dostępny
  if (typeof (window as any).Quill === "undefined") {
    console.error("Quill.js is not loaded");
    return;
  }

  // Inicjalizuj Quill editor
  extendedDescriptionQuill = new (window as any).Quill("#trip-extended-description-editor", {
    theme: "snow",
    modules: {
      toolbar: [
        [{ header: [1, 2, 3, false] }],
        ["bold", "italic", "underline"],
        [{ list: "ordered" }, { list: "bullet" }],
        ["blockquote"],
        [{ align: [] }],
        ["link"],
        ["clean"]
      ]
    },
    placeholder: "Wpisz szczegółowy opis wyjazdu... Możesz formatować tekst używając paska narzędzi."
  });

  // Zapisz zawartość do ukrytego pola przy zmianie
  extendedDescriptionQuill.on("text-change", () => {
    const hiddenInput = document.getElementById("trip-extended-description") as HTMLInputElement;
    if (hiddenInput && extendedDescriptionQuill) {
      const html = extendedDescriptionQuill.root.innerHTML;
      // Jeśli editor jest pusty (tylko <p><br></p>), ustaw pusty string (będzie wymagane przez walidację)
      const isEmpty = html.trim() === "<p><br></p>" || html.trim() === "";
      hiddenInput.value = isEmpty ? "" : html;
      // Ustaw walidację HTML5 dla pola required
      if (isEmpty) {
        hiddenInput.setCustomValidity("Pole 'Opis rozszerzony' jest wymagane");
      } else {
        hiddenInput.setCustomValidity("");
      }
    }
  });
}

function closeTripModal() {
  const modal = document.getElementById("trip-modal");
  if (modal) {
    modal.style.display = "none";
    currentEditingTripId = null;
    currentEditingTripHotelClass = null;

    // Nie czyść Quill editora - pozostaw go na wypadek ponownego otwarcia
    // (editor jest inicjalizowany tylko raz i przechowuje stan)
    const heroImagePreview = document.getElementById("trip-hero-image-preview");
    const heroImagePreviewImg = document.getElementById("trip-hero-image-preview-img") as HTMLImageElement;
    const heroImageInput = document.querySelector("#trip-hero-image") as HTMLInputElement;
    const heroImagePathInput = document.getElementById("trip-hero-image-path") as HTMLInputElement;

    if (heroImagePreview) heroImagePreview.style.display = "none";
    if (heroImagePreviewImg) heroImagePreviewImg.src = "";
    if (heroImageInput) heroImageInput.value = "";
    if (heroImagePathInput) heroImagePathInput.value = "";

    const cardImagePreview = document.getElementById("trip-card-image-preview");
    const cardImagePreviewImg = document.getElementById("trip-card-image-preview-img") as HTMLImageElement;
    const cardImageInput = document.querySelector("#trip-card-image") as HTMLInputElement;
    const cardImagePathInput = document.getElementById("trip-card-image-path") as HTMLInputElement;

    if (cardImagePreview) cardImagePreview.style.display = "none";
    if (cardImagePreviewImg) cardImagePreviewImg.src = "";
    if (cardImageInput) cardImageInput.value = "";
    if (cardImagePathInput) cardImagePathInput.value = "";
  }
}

async function loadTripForEdit(tripId: string) {
  if (!currentToken) return;

  try {
    const trip = (await adminApi.getTrip(currentToken, tripId)) as any;
    if (!trip) {
      notifications.error("Nie udało się załadować danych wyjazdu: brak danych");
      return;
    }
    const form = document.getElementById("trip-form") as HTMLFormElement;

    if (!form) {
      notifications.error("Nie udało się załadować danych wyjazdu: formularz nie znaleziony");
      return;
    }

    // Wypełnij formularz
    (form.querySelector("#trip-name") as HTMLInputElement).value = trip.name || "";
    (form.querySelector("#trip-details") as HTMLTextAreaElement).value = trip.details || "";
    (form.querySelector("#trip-tag") as HTMLInputElement).value = trip.tag || "";
    (form.querySelector("#trip-meta") as HTMLInputElement).value = trip.meta || "";
    
    // Wypełnij Quill editor dla extendedDescription
    if (extendedDescriptionQuill) {
      const extendedDesc = trip.extendedDescription || "";
      extendedDescriptionQuill.root.innerHTML = extendedDesc;
      const hiddenInput = document.getElementById("trip-extended-description") as HTMLInputElement;
      if (hiddenInput) {
        hiddenInput.value = extendedDesc;
      }
    }
    const startsAtInput = form.querySelector("#trip-starts-at") as HTMLInputElement;
    const endsAtInput = form.querySelector("#trip-ends-at") as HTMLInputElement;

    // Pola dat są teraz obowiązkowe (tylko data, bez czasu)
    const startsAtValue = new Date(trip.startsAt).toISOString().slice(0, 10);
    startsAtInput.value = startsAtValue;
    // Ustaw min dla endsAt
    if (endsAtInput) {
      endsAtInput.min = startsAtValue;
    }

    endsAtInput.value = new Date(trip.endsAt).toISOString().slice(0, 10);
    // priceCents jest teraz opcjonalne - cena jest w DeparturePoint
    // Ukryj pole ceny (zostanie zastąpione przez miejsca wylotu)
    const priceInputRow = form.querySelector('[for="trip-price"]')?.closest('.form-group')?.parentElement;
    if (priceInputRow && priceInputRow.classList.contains('form-row')) {
      const priceInputGroup = priceInputRow.querySelector('[for="trip-price"]')?.closest('.form-group');
      if (priceInputGroup) {
        (priceInputGroup as HTMLElement).style.display = 'none'; // Ukryj zamiast usuwać
      }
    }
    // Pola capacity i seatsLeft są teraz obowiązkowe
    (form.querySelector("#trip-capacity") as HTMLInputElement).value = String(trip.capacity);
    (form.querySelector("#trip-seats-left") as HTMLInputElement).value = String(trip.seatsLeft);
    (form.querySelector("#trip-spots-label") as HTMLInputElement).value = trip.spotsLabel || "";
    
    // Załaduj miejsca wylotu
    if (trip.departurePoints && Array.isArray(trip.departurePoints)) {
      renderDeparturePoints(trip.departurePoints);
    } else {
      renderDeparturePoints([]);
    }
    const useAutoSpotsLabelCheckbox = form.querySelector("#trip-use-auto-spots-label") as HTMLInputElement;
    if (useAutoSpotsLabelCheckbox) {
      // Pola capacity i seatsLeft są teraz zawsze wypełnione, więc checkbox może być zawsze aktywny
      useAutoSpotsLabelCheckbox.checked = trip.useAutoSpotsLabel === true;
      useAutoSpotsLabelCheckbox.disabled = false;
    }

    // Ustaw klasę hotelu
    currentEditingTripHotelClass = trip.hotelClass || null;
    setHotelClassStars(currentEditingTripHotelClass);
    (form.querySelector("#trip-is-featured") as HTMLInputElement).checked =
      trip.isFeatured || false;

    // Obsługa obrazów - ustaw ścieżki w hidden inputs i wyświetl podgląd
    const heroImagePathInput = document.getElementById("trip-hero-image-path") as HTMLInputElement;
    const heroImagePreview = document.getElementById("trip-hero-image-preview");
    const heroImagePreviewImg = document.getElementById("trip-hero-image-preview-img") as HTMLImageElement;
    const heroImageFileInput = form.querySelector("#trip-hero-image") as HTMLInputElement;

    if (trip.heroImagePath) {
      if (heroImagePathInput) heroImagePathInput.value = trip.heroImagePath;
      if (heroImagePreviewImg) heroImagePreviewImg.src = trip.heroImagePath;
      if (heroImagePreview) heroImagePreview.style.display = "block";
      if (heroImageFileInput) heroImageFileInput.value = ""; // Wyczyść file input
    } else {
      if (heroImagePathInput) heroImagePathInput.value = "";
      if (heroImagePreview) heroImagePreview.style.display = "none";
      if (heroImageFileInput) heroImageFileInput.value = "";
    }

    const cardImagePathInput = document.getElementById("trip-card-image-path") as HTMLInputElement;
    const cardImagePreview = document.getElementById("trip-card-image-preview");
    const cardImagePreviewImg = document.getElementById("trip-card-image-preview-img") as HTMLImageElement;
    const cardImageFileInput = form.querySelector("#trip-card-image") as HTMLInputElement;

    if (trip.cardImagePath) {
      if (cardImagePathInput) cardImagePathInput.value = trip.cardImagePath;
      if (cardImagePreviewImg) cardImagePreviewImg.src = trip.cardImagePath;
      if (cardImagePreview) cardImagePreview.style.display = "block";
      if (cardImageFileInput) cardImageFileInput.value = ""; // Wyczyść file input
    } else {
      if (cardImagePathInput) cardImagePathInput.value = "";
      if (cardImagePreview) cardImagePreview.style.display = "none";
      if (cardImageFileInput) cardImageFileInput.value = "";
    }

    // Wywołaj walidację po załadowaniu danych, aby upewnić się, że checkbox jest odpowiednio ustawiony
    // (jeśli event listenery są już ustawione)
    const capacityInput = form.querySelector("#trip-capacity") as HTMLInputElement;
    const seatsLeftInput = form.querySelector("#trip-seats-left") as HTMLInputElement;
    if (capacityInput && seatsLeftInput && useAutoSpotsLabelCheckbox) {
      // Wywołaj event, aby uruchomić walidację
      capacityInput.dispatchEvent(new Event("input", { bubbles: true }));
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Nieznany błąd";
    notifications.error(`Nie udało się załadować danych wyjazdu: ${errorMessage}`);
    console.error("Load trip error:", err);
  }
}

function validateTripDates(startsAt: string | null, endsAt: string | null): Record<string, string> {
  const errors: Record<string, string> = {};

  if (startsAt && endsAt) {
    const startDate = new Date(startsAt);
    const endDate = new Date(endsAt);

    if (isNaN(startDate.getTime())) {
      errors.startsAt = "Nieprawidłowa data rozpoczęcia";
    } else if (isNaN(endDate.getTime())) {
      errors.endsAt = "Nieprawidłowa data zakończenia";
    } else if (endDate < startDate) {
      errors.endsAt = "Data zakończenia nie może być wcześniejsza niż data rozpoczęcia";
    }
  } else if (endsAt && !startsAt) {
    errors.endsAt = "Nie można ustawić daty zakończenia bez daty rozpoczęcia";
  }

  return errors;
}

function validateTripCapacityAndSeats(
  capacity: string | null,
  seatsLeft: string | null,
  useAutoSpotsLabel: boolean
): Record<string, string> {
  const errors: Record<string, string> = {};

  const capacityValue = capacity?.trim() || null;
  const seatsLeftValue = seatsLeft?.trim() || null;

  // Pola są teraz obowiązkowe
  if (!capacityValue) {
    errors.capacity = "Pole 'Pojemność' jest wymagane";
  }
  if (!seatsLeftValue) {
    errors.seatsLeft = "Pole 'Wolne miejsca' jest wymagane";
  }

  const capacityNum = capacityValue ? parseInt(capacityValue, 10) : null;
  const seatsLeftNum = seatsLeftValue ? parseInt(seatsLeftValue, 10) : null;

  // Walidacja wartości liczbowych
  if (capacityNum !== null) {
    if (isNaN(capacityNum) || capacityNum < 0) {
      errors.capacity = "Pole 'Pojemność' musi być liczbą nieujemną";
    }
  }

  if (seatsLeftNum !== null) {
    if (isNaN(seatsLeftNum) || seatsLeftNum < 0) {
      errors.seatsLeft = "Pole 'Wolne miejsca' musi być liczbą nieujemną";
    } else if (capacityNum !== null && seatsLeftNum > capacityNum) {
      errors.seatsLeft = "Liczba wolnych miejsc nie może być większa niż pojemność";
    }
  }

  return errors;
}

// Miejsca wylotu - funkcje pomocnicze
function renderDeparturePoints(departurePoints: Array<{ id?: string; city: string; priceCents: number; currency?: string; isActive?: boolean; sortOrder?: number }>) {
  const container = document.getElementById("departure-points-container");
  if (!container) return;

  // Wyczyść kontener
  container.innerHTML = "";

  // Jeśli brak miejsc wylotu, pokaż pusty komunikat
  if (departurePoints.length === 0) {
    const emptyMessage = document.createElement("p");
    emptyMessage.id = "departure-points-empty";
    emptyMessage.style.cssText = "color: var(--dt-muted); text-align: center; margin: 20px 0; font-size: 14px; font-style: italic;";
    emptyMessage.textContent = "Brak miejsc wylotu. Dodaj co najmniej jedno miejsce wylotu.";
    container.appendChild(emptyMessage);
    return;
  }

  // Pobierz template
  const template = document.getElementById("departure-point-template") as HTMLTemplateElement;
  if (!template) {
    console.error("Departure point template not found");
    return;
  }

  // Renderuj każde miejsce wylotu
  departurePoints.forEach((dp) => {
    const clone = template.content.cloneNode(true) as DocumentFragment;
    const item = clone.querySelector(".departure-point-item");
    if (!item) return;

    // Ustaw ID jeśli istnieje
    if (dp.id) {
      item.setAttribute("data-departure-point-id", dp.id);
    }

    // Wypełnij pola
    const cityInput = clone.querySelector(".departure-point-city") as HTMLInputElement;
    const priceInput = clone.querySelector(".departure-point-price") as HTMLInputElement;
    const sortOrderInput = clone.querySelector(".departure-point-sort-order") as HTMLInputElement;
    const activeCheckbox = clone.querySelector(".departure-point-active") as HTMLInputElement;

    if (cityInput) cityInput.value = dp.city || "";
    if (priceInput) priceInput.value = dp.priceCents ? String(dp.priceCents / 100) : "";
    if (sortOrderInput) sortOrderInput.value = String(dp.sortOrder || 0);
    if (activeCheckbox) activeCheckbox.checked = dp.isActive !== false;

    // Ustaw listener dla przycisku usuwania
    const removeBtn = clone.querySelector(".btn-remove-departure-point");
    if (removeBtn) {
      removeBtn.addEventListener("click", () => {
        item.remove();
        updateDeparturePointsEmptyState();
      });
    }

    container.appendChild(clone);
  });

  updateDeparturePointsEmptyState();
}

function updateDeparturePointsEmptyState() {
  const container = document.getElementById("departure-points-container");
  if (!container) return;

  const items = container.querySelectorAll(".departure-point-item");
  const existingEmptyMessage = container.querySelector("#departure-points-empty");
  
  // Jeśli nie ma miejsc wylotu i nie ma pustego komunikatu, dodaj go
  if (items.length === 0 && !existingEmptyMessage) {
    const emptyMessage = document.createElement("p");
    emptyMessage.id = "departure-points-empty";
    emptyMessage.style.cssText = "color: var(--dt-muted); text-align: center; margin: 20px 0; font-size: 14px; font-style: italic;";
    emptyMessage.textContent = "Brak miejsc wylotu. Dodaj co najmniej jedno miejsce wylotu.";
    container.appendChild(emptyMessage);
  } else if (items.length > 0 && existingEmptyMessage) {
    // Jeśli są miejsca wylotu, usuń pusty komunikat
    existingEmptyMessage.remove();
  }
}

function getDeparturePointsFromForm(): Array<{ id?: string; city: string; priceCents: number; currency: string; isActive: boolean; sortOrder: number }> {
  const container = document.getElementById("departure-points-container");
  if (!container) return [];

  const items = container.querySelectorAll(".departure-point-item");
  const departurePoints: Array<{ id?: string; city: string; priceCents: number; currency: string; isActive: boolean; sortOrder: number }> = [];

  items.forEach((item) => {
    const cityInput = item.querySelector(".departure-point-city") as HTMLInputElement;
    const priceInput = item.querySelector(".departure-point-price") as HTMLInputElement;
    const sortOrderInput = item.querySelector(".departure-point-sort-order") as HTMLInputElement;
    const activeCheckbox = item.querySelector(".departure-point-active") as HTMLInputElement;

    if (!cityInput || !priceInput) return;

    const city = cityInput.value.trim();
    const price = parseFloat(priceInput.value);
    const sortOrder = sortOrderInput ? parseInt(sortOrderInput.value, 10) || 0 : 0;
    const isActive = activeCheckbox ? activeCheckbox.checked : true;

    if (city && !isNaN(price) && price > 0) {
      const id = item.getAttribute("data-departure-point-id");
      departurePoints.push({
        id: id || undefined,
        city,
        priceCents: Math.round(price * 100),
        currency: "PLN",
        isActive,
        sortOrder
      });
    }
  });

  return departurePoints;
}

function setupDeparturePointsListeners() {
  const addBtn = document.getElementById("add-departure-point-btn");
  if (addBtn) {
    addBtn.addEventListener("click", () => {
      const container = document.getElementById("departure-points-container");
      const template = document.getElementById("departure-point-template") as HTMLTemplateElement;
      if (!container || !template) return;

      const clone = template.content.cloneNode(true) as DocumentFragment;
      const item = clone.querySelector(".departure-point-item");
      if (!item) return;

      // Ustaw listener dla przycisku usuwania
      const removeBtn = clone.querySelector(".btn-remove-departure-point");
      if (removeBtn) {
        removeBtn.addEventListener("click", () => {
          item.remove();
          updateDeparturePointsEmptyState();
        });
      }

      // Usuń pusty komunikat jeśli istnieje
      const emptyMessage = document.getElementById("departure-points-empty");
      if (emptyMessage) {
        emptyMessage.style.display = "none";
      }

      container.appendChild(clone);
    });
  }

  // Ustaw listenery dla istniejących przycisków usuwania
  document.querySelectorAll(".btn-remove-departure-point").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const item = (e.target as HTMLElement).closest(".departure-point-item");
      if (item) {
        item.remove();
        updateDeparturePointsEmptyState();
      }
    });
  });
}

// Flaga, żeby zapobiec wielokrotnemu wywołaniu saveTrip
let isSavingTrip = false;

async function saveTrip(formData: FormData) {
  if (!currentToken) return;

  // Zapobiegaj wielokrotnemu wywołaniu
  if (isSavingTrip) {
    console.warn("saveTrip already in progress, ignoring duplicate call");
    return;
  }

  isSavingTrip = true;

  // Walidacja dat
  const startsAtValue = formData.get("startsAt") as string;
  const endsAtValue = formData.get("endsAt") as string;
  const dateErrors = validateTripDates(startsAtValue || null, endsAtValue || null);

  // Walidacja pojemności i miejsc
  const capacityValue = formData.get("capacity") as string;
  const seatsLeftValue = formData.get("seatsLeft") as string;
  const useAutoSpotsLabel = formData.get("useAutoSpotsLabel") === "on";
  const capacityErrors = validateTripCapacityAndSeats(
    capacityValue || null,
    seatsLeftValue || null,
    useAutoSpotsLabel
  );

  // Połącz wszystkie błędy
  const allErrors = { ...dateErrors, ...capacityErrors };

  if (Object.keys(allErrors).length > 0) {
    const form = document.getElementById("trip-form") as HTMLFormElement;
    if (form) {
      showFieldErrors(form, allErrors);
    }
    notifications.error("Popraw błędy w formularzu");
    isSavingTrip = false;
    return;
  }

  // Wyczyść błędy jeśli walidacja przeszła
  const form = document.getElementById("trip-form") as HTMLFormElement;
  if (form) {
    clearFieldErrors(form);
  }

  // Pobierz extendedDescription z ukrytego pola (Quill zapisuje tam HTML)
  const extendedDescriptionInput = document.getElementById("trip-extended-description") as HTMLInputElement;
  const extendedDescription = extendedDescriptionInput ? extendedDescriptionInput.value.trim() : "";
  
  // Walidacja extendedDescription (pole obowiązkowe)
  if (!extendedDescription || extendedDescription === "" || extendedDescription === "<p><br></p>") {
    const form = document.getElementById("trip-form") as HTMLFormElement;
    if (form) {
      showFieldErrors(form, { extendedDescription: "Pole 'Opis rozszerzony' jest wymagane" });
    }
    notifications.error("Pole 'Opis rozszerzony' jest wymagane");
    isSavingTrip = false;
    return;
  }

  // Pobierz miejsca wylotu z formularza
  const departurePoints = getDeparturePointsFromForm();
  
  // Walidacja miejsc wylotu
  if (!departurePoints || departurePoints.length === 0) {
    notifications.error("Dodaj co najmniej jedno miejsce wylotu");
    isSavingTrip = false;
    return;
  }

  // Walidacja każdego miejsca wylotu
  for (const dp of departurePoints) {
    if (!dp.city || dp.city.trim() === "") {
      notifications.error("Nazwa miasta wylotu jest wymagana dla wszystkich miejsc wylotu");
      isSavingTrip = false;
      return;
    }
    if (!dp.priceCents || dp.priceCents <= 0) {
      notifications.error(`Cena musi być większa od 0 dla miejsca wylotu: ${dp.city}`);
      isSavingTrip = false;
      return;
    }
  }

  const data: Record<string, unknown> = {
    name: formData.get("name") as string,
    details: formData.get("details") as string,
    extendedDescription: extendedDescription,
    tag: formData.get("tag") as string,
    meta: formData.get("meta") as string,
    currency: "PLN", // Zawsze PLN
    // priceCents nie jest wysyłane - cena jest w DeparturePoint
    isFeatured: formData.get("isFeatured") === "on"
  };

  // Pola obowiązkowe (tylko data, bez czasu - dodajemy 00:00:00)
  if (!startsAtValue) {
    notifications.error("Pole 'Data rozpoczęcia' jest wymagane");
    isSavingTrip = false;
    return;
  }
  // Dodaj czas 00:00:00 do daty przed konwersją na ISO string
  data.startsAt = new Date(startsAtValue + "T00:00:00").toISOString();

  if (!endsAtValue) {
    notifications.error("Pole 'Data zakończenia' jest wymagane");
    isSavingTrip = false;
    return;
  }
  // Dodaj czas 00:00:00 do daty przed konwersją na ISO string
  data.endsAt = new Date(endsAtValue + "T00:00:00").toISOString();

  const capacity = formData.get("capacity") as string;
  if (!capacity) {
    notifications.error("Pole 'Pojemność' jest wymagane");
    isSavingTrip = false;
    return;
  }
  data.capacity = parseInt(capacity, 10);

  const seatsLeft = formData.get("seatsLeft") as string;
  if (!seatsLeft) {
    notifications.error("Pole 'Wolne miejsca' jest wymagane");
    isSavingTrip = false;
    return;
  }
  const seatsLeftNum = parseInt(seatsLeft, 10);
  data.seatsLeft = seatsLeftNum;

  // Ustaw status dostępności: "CLOSED" jeśli wolne miejsca = 0, w przeciwnym razie "OPEN"
  data.availability = seatsLeftNum === 0 ? "CLOSED" : "OPEN";

  const spotsLabel = formData.get("spotsLabel") as string;
  if (spotsLabel) {
    data.spotsLabel = spotsLabel;
  } else {
    data.spotsLabel = null;
  }

  data.useAutoSpotsLabel = formData.get("useAutoSpotsLabel") === "on";

  // Klasa hotelu (obowiązkowa przy tworzeniu, opcjonalna przy edycji)
  const hotelClassValue = formData.get("hotelClass") as string;
  const hotelClassErrors: Record<string, string> = {};
  if (hotelClassValue) {
    const hotelClassNum = parseInt(hotelClassValue, 10);
    if (hotelClassNum < 1 || hotelClassNum > 5) {
      hotelClassErrors.hotelClass = "Klasa hotelu musi być w przedziale 1-5";
    } else {
      data.hotelClass = hotelClassNum;
    }
  } else if (!currentEditingTripId) {
    // Tylko przy tworzeniu nowego wyjazdu pole jest wymagane
    hotelClassErrors.hotelClass = "Pole 'Klasa hotelu' jest wymagane";
  } else if (currentEditingTripId && currentEditingTripHotelClass !== null) {
    // Przy edycji, jeśli wartość nie została podana, ale wyjazd ma już hotelClass, zachowaj obecną wartość
    data.hotelClass = currentEditingTripHotelClass;
  }
  // Przy edycji, jeśli wartość nie została podana i wyjazd nie ma hotelClass, nie wysyłamy pola
  
  // Jeśli są błędy walidacji klasy hotelu, pokaż je przy polu
  if (Object.keys(hotelClassErrors).length > 0) {
    const form = document.getElementById("trip-form") as HTMLFormElement;
    if (form) {
      showFieldErrors(form, hotelClassErrors);
    }
    isSavingTrip = false;
    return;
  }

  // Upload obrazów jeśli zostały wybrane
  const heroImageFile = formData.get("heroImage") as File | null;
  if (heroImageFile && heroImageFile.size > 0) {
    try {
      const uploadResult = await adminApi.uploadImage(currentToken, heroImageFile);
      data.heroImagePath = uploadResult.path;
    } catch (err) {
      notifications.error(`Nie udało się przesłać obrazu hero: ${err instanceof Error ? err.message : "Nieznany błąd"}`);
      isSavingTrip = false;
      return;
    }
  } else {
    // Użyj istniejącej ścieżki jeśli nie wybrano nowego pliku
    const heroImagePath = formData.get("heroImagePath") as string;
    data.heroImagePath = heroImagePath || null;
  }

  const cardImageFile = formData.get("cardImage") as File | null;
  if (cardImageFile && cardImageFile.size > 0) {
    try {
      const uploadResult = await adminApi.uploadImage(currentToken, cardImageFile);
      data.cardImagePath = uploadResult.path;
    } catch (err) {
      notifications.error(`Nie udało się przesłać obrazu karty: ${err instanceof Error ? err.message : "Nieznany błąd"}`);
      isSavingTrip = false;
      return;
    }
  } else {
    // Użyj istniejącej ścieżki jeśli nie wybrano nowego pliku
    const cardImagePath = formData.get("cardImagePath") as string;
    data.cardImagePath = cardImagePath || null;
  }

  try {
    let savedTripId: string;
    if (currentEditingTripId) {
      console.log("Sending update data:", JSON.stringify(data, null, 2));
      await adminApi.updateTrip(currentToken, currentEditingTripId, data);
      savedTripId = currentEditingTripId;
    } else {
      const newTrip = (await adminApi.createTrip(currentToken, data)) as any;
      if (!newTrip || !newTrip.id) {
        throw new Error("Nie udało się utworzyć wyjazdu: brak ID w odpowiedzi");
      }
      savedTripId = newTrip.id;
      currentEditingTripId = savedTripId; // Zaktualizuj currentEditingTripId dla dalszych operacji
    }

    // Po zapisaniu wyjazdu, zapisz miejsca wylotu
    // Najpierw usuń wszystkie istniejące miejsca wylotu (jeśli edytujemy)
    if (currentEditingTripId) {
      // Pobierz istniejące miejsca wylotu i usuń je
      try {
        const existingTrip = (await adminApi.getTrip(currentToken, savedTripId)) as any;
        if (existingTrip.departurePoints && Array.isArray(existingTrip.departurePoints)) {
          for (const dp of existingTrip.departurePoints) {
            try {
              await adminApi.deleteDeparturePoint(currentToken, savedTripId, dp.id);
            } catch (err) {
              console.error(`Failed to delete departure point ${dp.id}:`, err);
            }
          }
        }
      } catch (err) {
        console.error("Failed to load existing departure points:", err);
      }
    }

    // Dodaj nowe miejsca wylotu
    for (const dp of departurePoints) {
      try {
        await adminApi.createDeparturePoint(currentToken, savedTripId, {
          city: dp.city,
          priceCents: dp.priceCents,
          currency: "PLN",
          isActive: dp.isActive !== false,
          sortOrder: dp.sortOrder || 0
        });
      } catch (err) {
        console.error(`Failed to create departure point ${dp.city}:`, err);
        notifications.error(`Nie udało się zapisać miejsca wylotu: ${dp.city}`);
      }
    }

    // Tylko jeśli zapis się powiódł, pokaż sukces i przeładuj listę
    notifications.success(
      currentEditingTripId ? "Wyjazd został zaktualizowany" : "Wyjazd został dodany"
    );

    closeTripModal();

    // Przeładuj listę wyjazdów - jeśli się nie powiedzie, błąd zostanie obsłużony w loadTrips
    try {
      await loadTrips(currentPage.trips);
    } catch (loadError) {
      // Błąd przy ładowaniu listy nie powinien anulować sukcesu zapisu
      console.error("Error loading trips after save:", loadError);
    }
  } catch (err) {
    // Wyciągnij szczegóły błędu z odpowiedzi API
    let errorMessage = "Nieznany błąd";
    const fieldErrors: Record<string, string> = {};

    if (err instanceof Error) {
      errorMessage = err.message;
      // Jeśli błąd ma szczegóły (details), pokaż je
      const errorWithDetails = err as Error & { details?: unknown };
      if (errorWithDetails.details) {
        const details = errorWithDetails.details;
        console.error("Validation error details:", details);
        if (typeof details === "object" && details !== null) {
          const detailsArray = Array.isArray(details) ? details : [details];
          detailsArray.forEach((d: any) => {
            if (d.field && d.message) {
              fieldErrors[d.field] = d.message;
            } else if (d.path && d.message) {
              // Zod errors mają 'path' zamiast 'field'
              fieldErrors[d.path] = d.message;
            }
          });

          // Jeśli są błędy pól, pokaż je w formularzu
          if (Object.keys(fieldErrors).length > 0) {
            const form = document.getElementById("trip-form") as HTMLFormElement;
            if (form) {
              showFieldErrors(form, fieldErrors);
            }
            // Ustaw ogólny komunikat
            errorMessage = "Popraw błędy w formularzu";
          }
        }
      }
    }

    notifications.error(`Nie udało się zapisać wyjazdu: ${errorMessage}`);
    console.error("Save trip error:", err);
    console.error("Error details:", (err as any)?.details);
  } finally {
    // Zawsze resetuj flagę, nawet jeśli wystąpił błąd
    isSavingTrip = false;
  }
}

async function toggleTripActive(tripId: string, isActive: boolean) {
  if (!currentToken) return;

  const action = isActive ? "aktywować" : "deaktywować";
  if (!confirm(`Czy na pewno chcesz ${action} ten wyjazd?`)) {
    return;
  }

  try {
    if (isActive) {
      await adminApi.activateTrip(currentToken, tripId);
      notifications.success("Wyjazd został aktywowany");
    } else {
      await adminApi.deactivateTrip(currentToken, tripId);
      notifications.success("Wyjazd został deaktywowany");
    }
    // Przeładuj listę wyjazdów
    await loadTrips(currentPage.trips);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Nieznany błąd";
    notifications.error(`Nie udało się ${action} wyjazdu: ${errorMessage}`);
    console.error("Toggle trip active error:", err);
  }
}

function renderTripsTable(trips: any[], pagination: any) {
  const container = document.getElementById("trips-table-container")!;

  if (trips.length === 0) {
    container.innerHTML =
      "<p style='color: var(--dt-muted); text-align: center; padding: 40px;'>Brak wyjazdów</p>";
    return;
  }

  const table = document.createElement("table");
  table.innerHTML = `
    <thead>
      <tr>
        <th>Nazwa</th>
        <th>Status</th>
        <th>Cena</th>
        <th>Miejsca</th>
        <th>Zamówienia</th>
        <th>Data utworzenia</th>
        <th>Akcje</th>
      </tr>
    </thead>
    <tbody>
      ${trips
        .map(
          (trip) => `
        <tr ${!trip.isActive ? 'style="opacity: 0.6;"' : ""}>
          <td>${trip.name} ${!trip.isActive ? '<span style="color: var(--dt-muted); font-size: 0.9em;">(nieaktywny)</span>' : ""}</td>
          <td><span class="status-badge ${trip.availability}">${labelFrom(
            TRIP_AVAILABILITY_LABELS,
            trip.availability
          )}</span></td>
          <td>${trip.priceCents ? `${(trip.priceCents / 100).toLocaleString("pl-PL")} ${trip.currency}` : "Brak ceny"}</td>
          <td>${trip.seatsLeft !== null ? `${trip.seatsLeft}/${trip.capacity}` : "-"}</td>
          <td>${trip._count.orderItems}</td>
          <td>${new Date(trip.createdAt).toLocaleDateString("pl-PL")}</td>
          <td>
            <button class="btn-edit" data-trip-id="${trip.id}">Edytuj</button>
            <button class="btn-delete" data-trip-id="${trip.id}" data-trip-active="${trip.isActive}">
              ${trip.isActive ? "Deaktywuj" : "Aktywuj"}
            </button>
          </td>
        </tr>
      `
        )
        .join("")}
    </tbody>
  `;
  container.innerHTML = "";
  container.appendChild(table);

  // Dodaj event listenery dla przycisków edycji i usuwania
  table.querySelectorAll(".btn-edit").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tripId = (btn as HTMLElement).getAttribute("data-trip-id");
      if (tripId) {
        openTripModal(tripId);
      }
    });
  });

  table.querySelectorAll(".btn-delete").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tripId = (btn as HTMLElement).getAttribute("data-trip-id");
      const isActive = (btn as HTMLElement).getAttribute("data-trip-active") === "true";
      if (tripId) {
        toggleTripActive(tripId, !isActive);
      }
    });
  });

  renderPagination("trips-pagination", pagination, loadTrips);
}

// Load Users
async function loadUsers(page = 1) {
  if (!currentToken) return;

  const container = document.getElementById("users-table-container");
  if (!container) return;

  try {
    showLoading(container);
    const response = await adminApi.getUsers(currentToken, page, 50);

    // Sprawdź czy odpowiedź ma poprawną strukturę
    if (!response || !response.data || !response.pagination) {
      console.error("Invalid response structure:", response);
      throw new Error("Invalid response structure");
    }

    hideLoading(container);
    renderUsersTable(response.data as any[], response.pagination);
    currentPage.users = page;
  } catch (err) {
    hideLoading(container);
    notifications.error("Nie udało się załadować użytkowników");
    console.error("Users error:", err);
    container.innerHTML =
      "<p style='color: var(--dt-muted); text-align: center; padding: 40px;'>Nie udało się załadować danych. Sprawdź konsolę przeglądarki.</p>";
  }
}

function renderUsersTable(users: any[], pagination: any) {
  const container = document.getElementById("users-table-container")!;

  if (users.length === 0) {
    container.innerHTML =
      "<p style='color: var(--dt-muted); text-align: center; padding: 40px;'>Brak użytkowników</p>";
    return;
  }

  const table = document.createElement("table");
  table.innerHTML = `
    <thead>
      <tr>
        <th>Email</th>
        <th>Punkty</th>
        <th>Zamówienia</th>
        <th>Data rejestracji</th>
      </tr>
    </thead>
    <tbody>
      ${users
        .map(
          (user) => `
        <tr>
          <td>${user.email}</td>
          <td>${user.loyaltyAccount?.pointsBalance || 0}</td>
          <td>${user._count.orders}</td>
          <td>${new Date(user.createdAt).toLocaleDateString("pl-PL")}</td>
        </tr>
      `
        )
        .join("")}
    </tbody>
  `;
  container.innerHTML = "";
  container.appendChild(table);

  renderPagination("users-pagination", pagination, loadUsers);
}

// Load Newsletter
async function loadNewsletter(page = 1) {
  if (!currentToken) return;

  const container = document.getElementById("newsletter-table-container");
  if (!container) return;

  const statusFilterElement = document.getElementById(
    "newsletter-status-filter"
  ) as HTMLSelectElement;
  const statusFilter =
    statusFilterElement?.value && statusFilterElement.value.trim() !== ""
      ? statusFilterElement.value
      : undefined;

  try {
    showLoading(container);
    const response = await adminApi.getNewsletter(currentToken, page, 50, statusFilter);

    // Sprawdź czy odpowiedź ma poprawną strukturę
    if (!response || !response.data || !response.pagination) {
      console.error("Invalid response structure:", response);
      throw new Error("Invalid response structure");
    }

    hideLoading(container);
    renderNewsletterTable(response.data as any[], response.pagination);
    currentPage.newsletter = page;
  } catch (err) {
    hideLoading(container);
    notifications.error("Nie udało się załadować subskrybentów");
    console.error("Newsletter error:", err);
    container.innerHTML =
      "<p style='color: var(--dt-muted); text-align: center; padding: 40px;'>Nie udało się załadować danych. Sprawdź konsolę przeglądarki.</p>";
  }
}

function renderNewsletterTable(subscribers: any[], pagination: any) {
  const container = document.getElementById("newsletter-table-container")!;

  if (subscribers.length === 0) {
    container.innerHTML =
      "<p style='color: var(--dt-muted); text-align: center; padding: 40px;'>Brak subskrybentów</p>";
    return;
  }

  const table = document.createElement("table");
  table.innerHTML = `
    <thead>
      <tr>
        <th>Email</th>
        <th>Imię</th>
        <th>Status</th>
        <th>Data subskrypcji</th>
      </tr>
    </thead>
    <tbody>
      ${subscribers
        .map(
          (sub) => `
        <tr>
          <td>${sub.email}</td>
          <td>${sub.name || "-"}</td>
          <td><span class="status-badge ${sub.status}">${labelFrom(
            NEWSLETTER_STATUS_LABELS,
            sub.status
          )}</span></td>
          <td>${new Date(sub.createdAt).toLocaleDateString("pl-PL")}</td>
        </tr>
      `
        )
        .join("")}
    </tbody>
  `;
  container.innerHTML = "";
  container.appendChild(table);

  renderPagination("newsletter-pagination", pagination, loadNewsletter);
}

// Pagination
function renderPagination(containerId: string, pagination: any, loadFn: (page: number) => void) {
  const container = document.getElementById(containerId)!;
  const { page, totalPages } = pagination;

  if (totalPages <= 1) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = `
    <button class="pagination-prev" ${page <= 1 ? "disabled" : ""}>Poprzednia</button>
    <span class="page-info">Strona ${page} z ${totalPages}</span>
    <button class="pagination-next" ${page >= totalPages ? "disabled" : ""}>Następna</button>
  `;

  // Attach event listeners
  const prevBtn = container.querySelector(".pagination-prev") as HTMLButtonElement;
  const nextBtn = container.querySelector(".pagination-next") as HTMLButtonElement;

  if (prevBtn && !prevBtn.disabled) {
    prevBtn.addEventListener("click", () => loadFn(page - 1));
  }

  if (nextBtn && !nextBtn.disabled) {
    nextBtn.addEventListener("click", () => loadFn(page + 1));
  }
}

// Filters
document.getElementById("orders-status-filter")?.addEventListener("change", () => {
  // Jeśli użytkownik wybiera filtr statusu, wyłącz tryb "zaległe rezerwacje"
  showOverdueManualTransfers = false;
  const overdueBtn = document.getElementById("orders-overdue-manual-btn") as HTMLButtonElement | null;
  if (overdueBtn) {
    overdueBtn.classList.remove("active");
    overdueBtn.disabled = overdueManualTransfersCount <= 0;
  }
  loadOrders(1);
});

document.getElementById("orders-overdue-manual-btn")?.addEventListener("click", () => {
  showOverdueManualTransfers = !showOverdueManualTransfers;

  const statusFilterElement = document.getElementById("orders-status-filter") as HTMLSelectElement | null;
  if (statusFilterElement) {
    statusFilterElement.value = "";
  }

  const btn = document.getElementById("orders-overdue-manual-btn") as HTMLButtonElement | null;
  if (btn) {
    btn.classList.toggle("active", showOverdueManualTransfers);
    // jeśli jesteśmy w trybie zaległych, przycisk nie powinien się deaktywować nawet przy 0
    btn.disabled = overdueManualTransfersCount <= 0 && !showOverdueManualTransfers;
  }

  loadOrders(1);
});

document.getElementById("newsletter-status-filter")?.addEventListener("change", () => {
  loadNewsletter(1);
});

// ==================== CONTENT MANAGEMENT ====================

let currentContentSection: string | null = null;

// Content sidebar menu groups - toggle on hover/click
document.querySelectorAll(".sidebar-menu-group").forEach((group) => {
  const menuItem = group.querySelector(".sidebar-menu-item");
  if (!menuItem) return;

  menuItem.addEventListener("mouseenter", () => {
    group.classList.add("active");
  });

  group.addEventListener("mouseleave", () => {
    // Don't close if a submenu item is active
    if (!group.querySelector(".sidebar-submenu-item.active")) {
      group.classList.remove("active");
    }
  });
});

// Content section navigation (submenu items)
document.querySelectorAll(".sidebar-submenu-item").forEach((btn) => {
  btn.addEventListener("click", () => {
    const subpage = btn.getAttribute("data-subpage");
    const section = btn.getAttribute("data-section");
    if (!subpage || !section) return;

    // Update active submenu item
    document.querySelectorAll(".sidebar-submenu-item").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");

    // Keep parent menu group active
    const parentGroup = btn.closest(".sidebar-menu-group");
    if (parentGroup) {
      document.querySelectorAll(".sidebar-menu-group").forEach((g) => g.classList.remove("active"));
      parentGroup.classList.add("active");
    }

    currentContentSection = section;
    loadContentSection(subpage, section);
  });
});

// Load Content Tab
async function loadContent() {
  if (!currentToken) return;
  // Load first section by default if none is selected
  if (!currentContentSection) {
    const firstSubmenuItem = document.querySelector(".sidebar-submenu-item") as HTMLElement;
    if (firstSubmenuItem) {
      firstSubmenuItem.click();
    }
  } else {
    // Reload current section
    const activeItem = document.querySelector(".sidebar-submenu-item.active") as HTMLElement;
    if (activeItem) {
      const subpage = activeItem.getAttribute("data-subpage");
      const section = activeItem.getAttribute("data-section");
      if (subpage && section) {
        await loadContentSection(subpage, section);
      }
    }
  }
}

// Load Content Section (single section)
async function loadContentSection(subpage: string, section: string) {
  if (!currentToken) return;

  const pageMap: Record<string, "HOME" | "DREAM_POINTS" | "COOPERATION"> = {
    home: "HOME",
    "dream-points": "DREAM_POINTS",
    cooperation: "COOPERATION"
  };

  const page = pageMap[subpage];
  if (!page) return;

  // Show loading
  const sectionView = document.getElementById("content-section-view");
  const sectionTitle = document.getElementById("content-section-title");
  const sectionEditor = document.getElementById("content-section-editor-container");

  if (!sectionView || !sectionTitle || !sectionEditor) return;

  // Section title mapping
  const sectionTitles: Record<string, string> = {
    HOME_HERO: "Hero",
    HOME_UPCOMING_TRIPS: "Nadchodzące wyjazdy",
    HOME_HOW_IT_WORKS: "Jak to działa?",
    HOME_WHY_US: "Dlaczego my",
    HOME_NEWSLETTER: "Newsletter",
    DP_INTRO: "Wprowadzenie",
    DP_HOW_MANY: "Ile punktów zbierasz?",
    DP_VOUCHERS: "Jak wymieniasz DP na vouchery?",
    DP_WHY_ACCOUNT: "Dlaczego warto założyć konto?",
    COOP_INTRO: "Wprowadzenie",
    COOP_GALLERY: "Nasze realizacje",
    COOP_CONTACT: "Skontaktuj się z nami"
  };

  sectionTitle.textContent = sectionTitles[section] || section;
  sectionEditor.innerHTML = "";

  try {
    // Fetch specific section directly
    // apiRequest returns data.data ?? data, so for { data: content } it returns content
    const response = await adminApi.get(currentToken, `/content/${section}?_t=${Date.now()}`) as any;
    
    console.log(`[admin] Raw response for ${section}:`, response);
    console.log(`[admin] Response type:`, typeof response, Array.isArray(response));
    console.log(`[admin] Response.data:`, response?.data);
    
    // apiRequest returns data.data ?? data
    // Backend returns { data: content }, so apiRequest returns content directly
    // content is the full Content object: { id, page, section, data, createdAt, updatedAt }
    // content.data is the JSON field with the actual content data
    
    // Check if response is the content object directly or wrapped
    let contentData = null;
    if (response) {
      // If response has a 'data' property and it's an object (not an array), it's the content object
      if (response.data && typeof response.data === 'object' && !Array.isArray(response.data)) {
        // response is the content object, response.data is the JSON field
        contentData = response.data;
      } else if (response.section) {
        // response is already the content object
        contentData = response.data;
      } else {
        // Fallback: assume response is the content object
        contentData = response.data || response;
      }
    }

    console.log(`[admin] Content data extracted for ${section}:`, contentData);
    console.log(`[admin] Content data type:`, typeof contentData, Array.isArray(contentData));

    // Render editor for this section
    renderContentEditor(sectionEditor, section, contentData);
    
    // Show section view
    sectionView.classList.add("active");
  } catch (err) {
    // If section doesn't exist (404), show empty form
    const errorMessage = err instanceof Error ? err.message : String(err);
    if ((err as any)?.code === "NOT_FOUND" || errorMessage.includes("404") || errorMessage.includes("Not found")) {
      // Section doesn't exist in database - show empty form
      renderContentEditor(sectionEditor, section, null);
      sectionView.classList.add("active");
    } else {
      console.error(`[admin] Failed to load content for ${section}:`, err);
      notifications.error("Nie udało się załadować treści");
    }
  }
}

// Render Content Editor
function renderContentEditor(container: HTMLElement, section: string, data: any) {
  const editor = container;
  if (!editor) return;

  // Map section to page
  const sectionToPage: Record<string, "HOME" | "DREAM_POINTS" | "COOPERATION"> = {
    HOME_HERO: "HOME",
    HOME_UPCOMING_TRIPS: "HOME",
    HOME_HOW_IT_WORKS: "HOME",
    HOME_WHY_US: "HOME",
    HOME_NEWSLETTER: "HOME",
    DP_INTRO: "DREAM_POINTS",
    DP_HOW_MANY: "DREAM_POINTS",
    DP_VOUCHERS: "DREAM_POINTS",
    DP_WHY_ACCOUNT: "DREAM_POINTS",
    COOP_INTRO: "COOPERATION",
    COOP_GALLERY: "COOPERATION",
    COOP_CONTACT: "COOPERATION"
  };

  const page = sectionToPage[section];
  if (!page) return;

  // Clear editor
  editor.innerHTML = "";

  // Render fields based on section
  if (section === "HOME_HERO") {
    renderHeroEditor(editor as HTMLElement, section, page, data);
  } else if (section === "HOME_UPCOMING_TRIPS") {
    renderUpcomingTripsEditor(editor as HTMLElement, section, page, data);
  } else if (section === "HOME_HOW_IT_WORKS") {
    renderHowItWorksEditor(editor as HTMLElement, section, page, data);
  } else if (section === "HOME_WHY_US") {
    renderWhyUsEditor(editor as HTMLElement, section, page, data);
  } else if (section === "HOME_NEWSLETTER") {
    renderNewsletterEditor(editor as HTMLElement, section, page, data);
  } else if (section.startsWith("DP_")) {
    renderDreamPointsEditor(editor as HTMLElement, section, page, data);
  } else if (section.startsWith("COOP_")) {
    renderCooperationEditor(editor as HTMLElement, section, page, data);
  }
}

// Render Hero Editor
function renderHeroEditor(editor: HTMLElement, section: string, page: string, data: any) {
  // Use only data from database, no fallbacks
  const content = data || {};

  editor.innerHTML = `
    <div class="content-field">
      <label>Badge 1</label>
      <input type="text" data-field="badges.0" value="${escapeHtml(content.badges?.[0] || "")}" />
    </div>
    <div class="content-field">
      <label>Badge 2</label>
      <input type="text" data-field="badges.1" value="${escapeHtml(content.badges?.[1] || "")}" />
    </div>
    <div class="content-field">
      <label>Badge 3</label>
      <input type="text" data-field="badges.2" value="${escapeHtml(content.badges?.[2] || "")}" />
    </div>
    <div class="content-field">
      <label>Tytuł</label>
      <textarea data-field="title" rows="3">${escapeHtml(content.title || "")}</textarea>
    </div>
    <div class="content-field">
      <label>Opis</label>
      <textarea data-field="description" rows="4">${escapeHtml(content.description || "")}</textarea>
    </div>
    <div class="content-field">
      <label>Notatka</label>
      <textarea data-field="note" rows="2">${escapeHtml(content.note || "")}</textarea>
    </div>
    <div class="content-field">
      <label>Tekst przycisku CTA</label>
      <input type="text" data-field="ctaText" value="${escapeHtml(content.ctaText || "")}" />
    </div>
    <div class="content-field">
      <label>Tekst pod przyciskiem CTA</label>
      <input type="text" data-field="ctaSubtext" value="${escapeHtml(content.ctaSubtext || "")}" />
    </div>
    <button type="button" class="btn-primary content-save-btn" data-section="${section}">Zapisz</button>
  `;

  setupContentSaveHandler(editor, section, page);
}

// Render Upcoming Trips Editor
function renderUpcomingTripsEditor(editor: HTMLElement, section: string, page: string, data: any) {
  // Use only data from database, no fallbacks
  const content = data || {};

  editor.innerHTML = `
    <div class="content-field">
      <label>Tytuł</label>
      <input type="text" data-field="title" value="${escapeHtml(content.title || "")}" />
    </div>
    <div class="content-field">
      <label>Podtytuł</label>
      <textarea data-field="subtitle" rows="3">${escapeHtml(content.subtitle || "")}</textarea>
    </div>
    <button type="button" class="btn-primary content-save-btn" data-section="${section}">Zapisz</button>
  `;

  setupContentSaveHandler(editor, section, page);
}

// Render How It Works Editor
function renderHowItWorksEditor(editor: HTMLElement, section: string, page: string, data: any) {
  // Use only data from database, no fallbacks
  const content = data || {};

  let stepsHtml = "";
  (content.steps || []).forEach((step: any, index: number) => {
    stepsHtml += `
      <div class="content-array-item">
        <div class="content-array-item-header">
          <span class="content-array-item-title">Krok ${index + 1}</span>
        </div>
        <div class="content-field">
          <label>Tytuł</label>
          <input type="text" data-field="steps.${index}.title" value="${escapeHtml(step.title || "")}" />
        </div>
        <div class="content-field">
          <label>Opis</label>
          <textarea data-field="steps.${index}.description" rows="3">${escapeHtml(step.description || "")}</textarea>
        </div>
      </div>
    `;
  });

  editor.innerHTML = `
    <div class="content-field">
      <label>Tytuł</label>
      <input type="text" data-field="title" value="${escapeHtml(content.title || "")}" />
    </div>
    <div class="content-field">
      <label>Podtytuł</label>
      <textarea data-field="subtitle" rows="2">${escapeHtml(content.subtitle || "")}</textarea>
    </div>
    <div class="content-field">
      <label>Kroki</label>
      ${stepsHtml}
    </div>
    <button type="button" class="btn-primary content-save-btn" data-section="${section}">Zapisz</button>
  `;

  setupContentSaveHandler(editor, section, page);
}

// Render Why Us Editor
function renderWhyUsEditor(editor: HTMLElement, section: string, page: string, data: any) {
  // Use only data from database, no fallbacks
  const content = data || {};

  let cardsHtml = "";
  (content.cards || []).forEach((card: any, index: number) => {
    cardsHtml += `
      <div class="content-array-item">
        <div class="content-array-item-header">
          <span class="content-array-item-title">Karta ${index + 1}</span>
        </div>
        <div class="content-field">
          <label>Tytuł</label>
          <input type="text" data-field="cards.${index}.title" value="${escapeHtml(card.title || "")}" />
        </div>
        <div class="content-field">
          <label>Opis</label>
          <textarea data-field="cards.${index}.description" rows="3">${escapeHtml(card.description || "")}</textarea>
        </div>
      </div>
    `;
  });

  editor.innerHTML = `
    <div class="content-field">
      <label>Tytuł</label>
      <input type="text" data-field="title" value="${escapeHtml(content.title || "")}" />
    </div>
    <div class="content-field">
      <label>Podtytuł</label>
      <textarea data-field="subtitle" rows="2">${escapeHtml(content.subtitle || "")}</textarea>
    </div>
    <div class="content-field">
      <label>Karty</label>
      ${cardsHtml}
    </div>
    <button type="button" class="btn-primary content-save-btn" data-section="${section}">Zapisz</button>
  `;

  setupContentSaveHandler(editor, section, page);
}

// Render Newsletter Editor
function renderNewsletterEditor(editor: HTMLElement, section: string, page: string, data: any) {
  // Use only data from database, no fallbacks
  const content = data || {};

  editor.innerHTML = `
    <div class="content-field">
      <label>Tytuł</label>
      <input type="text" data-field="title" value="${escapeHtml(content.title || "")}" />
    </div>
    <div class="content-field">
      <label>Podtytuł</label>
      <textarea data-field="subtitle" rows="3">${escapeHtml(content.subtitle || "")}</textarea>
    </div>
    <button type="button" class="btn-primary content-save-btn" data-section="${section}">Zapisz</button>
  `;

  setupContentSaveHandler(editor, section, page);
}

// Render Dream Points Editor (generic)
function renderDreamPointsEditor(editor: HTMLElement, section: string, page: string, data: any) {
  // Use only data from database, no fallbacks
  const content = data || {};

  let html = "";

  if (section === "DP_INTRO") {
    html = `
      <div class="content-field">
        <label>Tytuł</label>
        <input type="text" data-field="title" value="${escapeHtml(content.title || "")}" />
      </div>
      <div class="content-field">
        <label>Podtytuł</label>
        <textarea data-field="subtitle" rows="4">${escapeHtml(content.subtitle || "")}</textarea>
      </div>
    `;
  } else if (section === "DP_HOW_MANY") {
    let paragraphsHtml = "";
    (content.paragraphs || []).forEach((para: string, index: number) => {
      paragraphsHtml += `
        <div class="content-field">
          <label>Akapit ${index + 1}</label>
          <textarea data-field="paragraphs.${index}" rows="2">${escapeHtml(para || "")}</textarea>
        </div>
      `;
    });
    html = `
      <div class="content-field">
        <label>Tytuł</label>
        <input type="text" data-field="title" value="${escapeHtml(content.title || "")}" />
      </div>
      ${paragraphsHtml}
    `;
  } else if (section === "DP_VOUCHERS") {
    html = `
      <div class="content-field">
        <label>Tytuł</label>
        <input type="text" data-field="title" value="${escapeHtml(content.title || "")}" />
      </div>
      <div class="content-field">
        <label>Opis</label>
        <textarea data-field="description" rows="3">${escapeHtml(content.description || "")}</textarea>
      </div>
      <div class="content-field">
        <label>Notatka</label>
        <textarea data-field="note" rows="2">${escapeHtml(content.note || "")}</textarea>
      </div>
    `;
  } else if (section === "DP_WHY_ACCOUNT") {
    let itemsHtml = "";
    (content.items || []).forEach((item: string, index: number) => {
      itemsHtml += `
        <div class="content-field">
          <label>Punkt ${index + 1}</label>
          <textarea data-field="items.${index}" rows="2">${escapeHtml(item || "")}</textarea>
        </div>
      `;
    });
    html = `
      <div class="content-field">
        <label>Tytuł</label>
        <input type="text" data-field="title" value="${escapeHtml(content.title || "")}" />
      </div>
      <div class="content-field">
        <label>Punkty listy</label>
        ${itemsHtml}
      </div>
      <div class="content-field">
        <label>Notatka</label>
        <textarea data-field="note" rows="2">${escapeHtml(content.note || "")}</textarea>
      </div>
      <div class="content-field">
        <label>Stopka</label>
        <textarea data-field="footer" rows="2">${escapeHtml(content.footer || "")}</textarea>
      </div>
    `;
  }

  editor.innerHTML = html + `<button type="button" class="btn-primary content-save-btn" data-section="${section}">Zapisz</button>`;
  setupContentSaveHandler(editor, section, page);
}

// Render Cooperation Editor
function renderCooperationEditor(editor: HTMLElement, section: string, page: string, data: any) {
  // Use only data from database, no fallbacks
  const content = data || {};

  let html = "";

  if (section === "COOP_INTRO") {
    let paragraphsHtml = "";
    (content.paragraphs || []).forEach((para: string, index: number) => {
      paragraphsHtml += `
        <div class="content-field">
          <label>Akapit ${index + 1}</label>
          <textarea data-field="paragraphs.${index}" rows="3">${escapeHtml(para || "")}</textarea>
        </div>
      `;
    });
    html = `
      <div class="content-field">
        <label>Tytuł</label>
        <input type="text" data-field="title" value="${escapeHtml(content.title || "")}" />
      </div>
      ${paragraphsHtml}
    `;
  } else if (section === "COOP_GALLERY") {
    html = `
      <div class="content-field">
        <label>Tytuł</label>
        <input type="text" data-field="title" value="${escapeHtml(content.title || "")}" />
      </div>
      <div class="content-field">
        <label>Podtytuł</label>
        <textarea data-field="subtitle" rows="2">${escapeHtml(content.subtitle || "")}</textarea>
      </div>
    `;
  } else if (section === "COOP_CONTACT") {
    let typesHtml = "";
    (content.cooperationTypes || []).forEach((type: string, index: number) => {
      typesHtml += `
        <div class="content-field">
          <label>Typ współpracy ${index + 1}</label>
          <input type="text" data-field="cooperationTypes.${index}" value="${escapeHtml(type || "")}" />
        </div>
      `;
    });
    html = `
      <div class="content-field">
        <label>Tytuł</label>
        <input type="text" data-field="title" value="${escapeHtml(content.title || "")}" />
      </div>
      <div class="content-field">
        <label>Podtytuł</label>
        <textarea data-field="subtitle" rows="2">${escapeHtml(content.subtitle || "")}</textarea>
      </div>
      <div class="content-field">
        <label>E-mail</label>
        <input type="email" data-field="contactInfo.email" value="${escapeHtml(content.contactInfo?.email || "")}" />
      </div>
      <div class="content-field">
        <label>Telefon</label>
        <input type="text" data-field="contactInfo.phone" value="${escapeHtml(content.contactInfo?.phone || "")}" />
      </div>
      <div class="content-field">
        <label>Godziny pracy</label>
        <input type="text" data-field="contactInfo.hours" value="${escapeHtml(content.contactInfo?.hours || "")}" />
      </div>
      <div class="content-field">
        <label>Formy współpracy</label>
        ${typesHtml}
      </div>
    `;
  }

  editor.innerHTML = html + `<button type="button" class="btn-primary content-save-btn" data-section="${section}">Zapisz</button>`;
  setupContentSaveHandler(editor, section, page);
}

// Setup Content Save Handler
function setupContentSaveHandler(editor: HTMLElement, section: string, page: string) {
  const saveBtn = editor.querySelector(`.content-save-btn[data-section="${section}"]`) as HTMLButtonElement;
  if (!saveBtn) {
    console.warn(`[admin] Save button not found for section: ${section}`);
    return;
  }

  // Remove existing listeners to avoid duplicates
  const newSaveBtn = saveBtn.cloneNode(true) as HTMLButtonElement;
  saveBtn.parentNode?.replaceChild(newSaveBtn, saveBtn);

  newSaveBtn.addEventListener("click", async () => {
    if (!currentToken) return;

    // Collect data from all fields
    const data: any = {};
    const fields = editor.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-field]");
    
    if (fields.length === 0) {
      console.warn(`[admin] No fields found for section: ${section}`);
      notifications.error("Brak pól do zapisania");
      return;
    }
    
    fields.forEach((field) => {
      const path = field.getAttribute("data-field");
      if (!path) return;

      const keys = path.split(".");
      let current = data;
      
      for (let i = 0; i < keys.length - 1; i++) {
        const key = keys[i];
        const nextKey = keys[i + 1];
        
        // Check if next key is a number (array index)
        if (!isNaN(Number(nextKey))) {
          if (!current[key]) current[key] = [];
        } else {
          if (!current[key]) current[key] = {};
        }
        
        current = current[key];
      }
      
      const lastKey = keys[keys.length - 1];
      // Only set value if field is not empty
      if (field.value.trim() !== "") {
        current[lastKey] = field.value;
      } else {
        // For array fields, set empty string to maintain array structure
        if (!isNaN(Number(lastKey))) {
          current[lastKey] = "";
        }
      }
    });

    // Clean up empty array elements for badges
    if (data.badges && Array.isArray(data.badges)) {
      data.badges = data.badges.filter((badge: string) => badge && badge.trim() !== "");
    }

    
    try {
      setButtonLoading(newSaveBtn, true, "Zapisywanie...");
      const response = await adminApi.put(currentToken, `/content/${section}`, {
        page,
        data
      });
      notifications.success("Treść została zapisana");
      setButtonLoading(newSaveBtn, false);
      
      // Reload the section to show updated data
      const activeSubmenuItem = document.querySelector(".sidebar-submenu-item.active") as HTMLElement;
      if (activeSubmenuItem) {
        const subpage = activeSubmenuItem.getAttribute("data-subpage");
        if (subpage && section) {
          await loadContentSection(subpage, section);
        }
      }
    } catch (err) {
      console.error("[admin] Failed to save content:", err);
      const errorMessage = err instanceof Error ? err.message : "Nie udało się zapisać treści";
      const errorDetails = (err as any)?.details;
      console.error("[admin] Error details:", errorDetails);
      console.error("[admin] Request was:", { section, page, data });
      notifications.error(errorMessage);
      setButtonLoading(newSaveBtn, false);
    }
  });
  
}

// Helper function to escape HTML
function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// Initialize
checkAuth();

// Flaga, żeby sprawdzić, czy listenery już są ustawione
let tripModalListenersSetup = false;

// Named handlers dla event listenerów (żeby móc je usunąć)
let tripFormSubmitHandler: ((e: Event) => void) | null = null;
let tripStartsAtChangeHandler: (() => void) | null = null;
let tripEndsAtChangeHandler: (() => void) | null = null;
let tripCapacityChangeHandler: (() => void) | null = null;
let tripSeatsLeftChangeHandler: (() => void) | null = null;
let tripUseAutoSpotsLabelChangeHandler: (() => void) | null = null;

// Event listeners dla modala - użyj DOMContentLoaded lub delegacji zdarzeń
function setupTripModalListeners() {
  // Jeśli listenery już są ustawione, nie dodawaj ich ponownie
  if (tripModalListenersSetup) {
    return;
  }

  const addBtn = document.getElementById("add-trip-btn");
  if (addBtn) {
    addBtn.addEventListener("click", () => {
      openTripModal();
    });
  }

  const closeBtn = document.getElementById("trip-modal-close");
  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      closeTripModal();
    });
  }

  const cancelBtn = document.getElementById("trip-form-cancel");
  if (cancelBtn) {
    cancelBtn.addEventListener("click", () => {
      closeTripModal();
    });
  }

  const form = document.getElementById("trip-form");
  if (form) {
    // Usuń poprzedni listener jeśli istnieje
    if (tripFormSubmitHandler) {
      form.removeEventListener("submit", tripFormSubmitHandler);
    }

    // Utwórz nowy handler
    tripFormSubmitHandler = (e: Event) => {
      e.preventDefault();
      const formData = new FormData(e.target as HTMLFormElement);
      saveTrip(formData);
    };

    form.addEventListener("submit", tripFormSubmitHandler);

    // Walidacja dat w czasie rzeczywistym
    const startsAtInput = form.querySelector("#trip-starts-at") as HTMLInputElement;
    const endsAtInput = form.querySelector("#trip-ends-at") as HTMLInputElement;

    if (startsAtInput) {
      // Usuń poprzedni listener jeśli istnieje
      if (tripStartsAtChangeHandler) {
        startsAtInput.removeEventListener("change", tripStartsAtChangeHandler);
      }

      // Utwórz nowy handler
      tripStartsAtChangeHandler = () => {
        const startsAt = startsAtInput.value || null;
        const endsAt = endsAtInput?.value || null;
        const errors = validateTripDates(startsAt, endsAt);

        // Wyczyść błędy dla obu pól dat
        clearFieldErrors(form);

        // Pokaż tylko błędy związane z datami
        if (Object.keys(errors).length > 0) {
          showFieldErrors(form, errors);
        }

        // Ustaw min dla endsAt jeśli startsAt jest ustawione
        if (startsAt && endsAtInput) {
          endsAtInput.min = startsAt;
        } else if (!startsAt && endsAtInput) {
          endsAtInput.min = "";
        }
      };

      startsAtInput.addEventListener("change", tripStartsAtChangeHandler);
    }

    if (endsAtInput) {
      // Usuń poprzedni listener jeśli istnieje
      if (tripEndsAtChangeHandler) {
        endsAtInput.removeEventListener("change", tripEndsAtChangeHandler);
      }

      // Utwórz nowy handler
      tripEndsAtChangeHandler = () => {
        const startsAt = startsAtInput?.value || null;
        const endsAt = endsAtInput.value || null;
        const errors = validateTripDates(startsAt, endsAt);

        // Wyczyść błędy dla obu pól dat
        clearFieldErrors(form);

        // Pokaż tylko błędy związane z datami
        if (Object.keys(errors).length > 0) {
          showFieldErrors(form, errors);
        }
      };

      endsAtInput.addEventListener("change", tripEndsAtChangeHandler);
    }

    // Walidacja pojemności i miejsc w czasie rzeczywistym
    const capacityInput = form.querySelector("#trip-capacity") as HTMLInputElement;
    const seatsLeftInput = form.querySelector("#trip-seats-left") as HTMLInputElement;
    const useAutoSpotsLabelCheckbox = form.querySelector("#trip-use-auto-spots-label") as HTMLInputElement;

    // Funkcja pomocnicza do walidacji i aktualizacji checkboxa
    const validateAndUpdateCheckbox = () => {
      const capacity = capacityInput?.value || null;
      const seatsLeft = seatsLeftInput?.value || null;
      const useAutoSpotsLabel = useAutoSpotsLabelCheckbox?.checked || false;

      const errors = validateTripCapacityAndSeats(capacity, seatsLeft, useAutoSpotsLabel);

      // Wyczyść błędy dla pól capacity/seatsLeft/useAutoSpotsLabel
      // (ale nie dla innych pól, więc nie używamy clearFieldErrors)
      const capacityField = form.querySelector("#trip-capacity") as HTMLInputElement;
      const seatsLeftField = form.querySelector("#trip-seats-left") as HTMLInputElement;
      const useAutoSpotsLabelField = form.querySelector("#trip-use-auto-spots-label") as HTMLInputElement;

      // Usuń komunikaty błędów dla tych pól
      if (capacityField) {
        const errorElement = capacityField.closest(".form-group")?.querySelector(".field-error-message");
        if (errorElement) errorElement.remove();
        capacityField.classList.remove("field-error");
        capacityField.removeAttribute("aria-invalid");
        capacityField.removeAttribute("aria-describedby");
      }
      if (seatsLeftField) {
        const errorElement = seatsLeftField.closest(".form-group")?.querySelector(".field-error-message");
        if (errorElement) errorElement.remove();
        seatsLeftField.classList.remove("field-error");
        seatsLeftField.removeAttribute("aria-invalid");
        seatsLeftField.removeAttribute("aria-describedby");
      }
      if (useAutoSpotsLabelField) {
        const errorElement = useAutoSpotsLabelField.closest("label")?.querySelector(".field-error-message");
        if (errorElement) errorElement.remove();
        useAutoSpotsLabelField.closest("label")?.classList.remove("field-error");
        useAutoSpotsLabelField.removeAttribute("aria-invalid");
        useAutoSpotsLabelField.removeAttribute("aria-describedby");
      }

      // Pokaż błędy jeśli są - używamy własnej implementacji, bo showFieldErrors szuka .field-group
      if (Object.keys(errors).length > 0) {
        for (const [fieldName, errorMessage] of Object.entries(errors)) {
          let field: HTMLElement | null = null;
          if (fieldName === "capacity") {
            field = capacityField;
          } else if (fieldName === "seatsLeft") {
            field = seatsLeftField;
          } else if (fieldName === "useAutoSpotsLabel") {
            field = useAutoSpotsLabelField;
          }

          if (!field) continue;

          // Dodaj klasę błędu do pola
          field.classList.add("field-error");
          field.setAttribute("aria-invalid", "true");
          const errorId = `error-${fieldName}`;
          field.setAttribute("aria-describedby", errorId);

          // Znajdź form-group (rodzic)
          const formGroup = field.closest(".form-group") || field.closest("label");
          if (formGroup) {
            // Sprawdź czy komunikat błędu już istnieje
            let errorEl = formGroup.querySelector(`#${errorId}`) as HTMLElement;
            if (!errorEl) {
              // Utwórz element błędu
              errorEl = document.createElement("div");
              errorEl.id = errorId;
              errorEl.className = "field-error-message";
              errorEl.setAttribute("role", "alert");
              // Dodaj po polu (lub na końcu form-group)
              formGroup.appendChild(errorEl);
            }
            errorEl.textContent = errorMessage;
          }
        }
      }

      // Pola capacity i seatsLeft są teraz zawsze wypełnione (required), więc checkbox może być zawsze aktywny
      if (useAutoSpotsLabelCheckbox) {
        useAutoSpotsLabelCheckbox.disabled = false;
      }
    };

    if (capacityInput) {
      // Usuń poprzedni listener jeśli istnieje
      if (tripCapacityChangeHandler) {
        capacityInput.removeEventListener("change", tripCapacityChangeHandler);
        capacityInput.removeEventListener("input", tripCapacityChangeHandler);
      }

      // Utwórz nowy handler
      tripCapacityChangeHandler = () => {
        validateAndUpdateCheckbox();
      };

      capacityInput.addEventListener("change", tripCapacityChangeHandler);
      capacityInput.addEventListener("input", tripCapacityChangeHandler);
    }

    if (seatsLeftInput) {
      // Usuń poprzedni listener jeśli istnieje
      if (tripSeatsLeftChangeHandler) {
        seatsLeftInput.removeEventListener("change", tripSeatsLeftChangeHandler);
        seatsLeftInput.removeEventListener("input", tripSeatsLeftChangeHandler);
      }

      // Utwórz nowy handler
      tripSeatsLeftChangeHandler = () => {
        validateAndUpdateCheckbox();
      };

      seatsLeftInput.addEventListener("change", tripSeatsLeftChangeHandler);
      seatsLeftInput.addEventListener("input", tripSeatsLeftChangeHandler);
    }

    if (useAutoSpotsLabelCheckbox) {
      // Usuń poprzedni listener jeśli istnieje
      if (tripUseAutoSpotsLabelChangeHandler) {
        useAutoSpotsLabelCheckbox.removeEventListener("change", tripUseAutoSpotsLabelChangeHandler);
      }

      // Utwórz nowy handler
      tripUseAutoSpotsLabelChangeHandler = () => {
        validateAndUpdateCheckbox();
      };

      useAutoSpotsLabelCheckbox.addEventListener("change", tripUseAutoSpotsLabelChangeHandler);

      // Ustaw początkowy stan checkboxa
      validateAndUpdateCheckbox();
    }

    // Obsługa uploadu i podglądu obrazów
    const heroImageInput = form.querySelector("#trip-hero-image") as HTMLInputElement;
    const heroImagePreview = document.getElementById("trip-hero-image-preview");
    const heroImagePreviewImg = document.getElementById("trip-hero-image-preview-img") as HTMLImageElement;
    const heroImagePathInput = document.getElementById("trip-hero-image-path") as HTMLInputElement;
    const heroImageRemoveBtn = document.getElementById("trip-hero-image-remove");

    if (heroImageInput && heroImagePreview && heroImagePreviewImg && heroImagePathInput) {
      heroImageInput.addEventListener("change", (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = (event) => {
            heroImagePreviewImg.src = event.target?.result as string;
            heroImagePreview.style.display = "block";
          };
          reader.readAsDataURL(file);
        }
      });

      if (heroImageRemoveBtn) {
        heroImageRemoveBtn.addEventListener("click", async () => {
          // Jeśli istnieje zapisana ścieżka, usuń plik z serwera
          const existingPath = heroImagePathInput.value;
          if (existingPath && currentToken) {
            try {
              await adminApi.deleteImage(currentToken, existingPath);
            } catch (err) {
              console.error("Failed to delete image from server:", err);
              // Kontynuuj usuwanie z podglądu nawet jeśli usunięcie z serwera się nie powiodło
            }
          }

          heroImageInput.value = "";
          heroImagePreview.style.display = "none";
          heroImagePreviewImg.src = "";
          heroImagePathInput.value = "";
        });
      }
    }

    const cardImageInput = form.querySelector("#trip-card-image") as HTMLInputElement;
    const cardImagePreview = document.getElementById("trip-card-image-preview");
    const cardImagePreviewImg = document.getElementById("trip-card-image-preview-img") as HTMLImageElement;
    const cardImagePathInput = document.getElementById("trip-card-image-path") as HTMLInputElement;
    const cardImageRemoveBtn = document.getElementById("trip-card-image-remove");

    if (cardImageInput && cardImagePreview && cardImagePreviewImg && cardImagePathInput) {
      cardImageInput.addEventListener("change", (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = (event) => {
            cardImagePreviewImg.src = event.target?.result as string;
            cardImagePreview.style.display = "block";
          };
          reader.readAsDataURL(file);
        }
      });

      if (cardImageRemoveBtn) {
        cardImageRemoveBtn.addEventListener("click", async () => {
          // Jeśli istnieje zapisana ścieżka, usuń plik z serwera
          const existingPath = cardImagePathInput.value;
          if (existingPath && currentToken) {
            try {
              await adminApi.deleteImage(currentToken, existingPath);
            } catch (err) {
              console.error("Failed to delete image from server:", err);
              // Kontynuuj usuwanie z podglądu nawet jeśli usunięcie z serwera się nie powiodło
            }
          }

          cardImageInput.value = "";
          cardImagePreview.style.display = "none";
          cardImagePreviewImg.src = "";
          cardImagePathInput.value = "";
        });
      }
    }
  }

  // Oznacz, że listenery są już ustawione
  tripModalListenersSetup = true;
}

// Funkcja do pozycjonowania tooltipów przy krawędziach
// Inicjalizuj gwiazdki klasy hotelu
function setupHotelClassStars() {
  const starsContainer = document.getElementById("hotel-class-stars");
  const hiddenInput = document.getElementById("trip-hotel-class") as HTMLInputElement;
  if (!starsContainer || !hiddenInput) return;

  const starButtons = starsContainer.querySelectorAll(".star-btn");
  
  starButtons.forEach((btn) => {
    // Usuń poprzedni listener jeśli istnieje
    const existingHandler = (btn as any).__hotelClassHandler;
    if (existingHandler) {
      btn.removeEventListener("click", existingHandler);
    }

    // Utwórz nowy handler
    const handler = () => {
      const rating = parseInt((btn as HTMLElement).dataset.rating || "0", 10);
      setHotelClassStars(rating);
    };

    // Zapisz handler i dodaj listener
    (btn as any).__hotelClassHandler = handler;
    btn.addEventListener("click", handler);
  });
}

// Ustaw klasę hotelu (1-5) i zaktualizuj wygląd gwiazdek
function setHotelClassStars(rating: number | null) {
  const starsContainer = document.getElementById("hotel-class-stars");
  const hiddenInput = document.getElementById("trip-hotel-class") as HTMLInputElement;
  if (!starsContainer || !hiddenInput) return;

  const starButtons = starsContainer.querySelectorAll(".star-btn");
  
  starButtons.forEach((btn, index) => {
    const starRating = index + 1;
    if (rating && starRating <= rating) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });

  hiddenInput.value = rating ? String(rating) : "";
}

function setupTooltipPositioning() {
  const modal = document.getElementById("trip-modal");
  if (!modal) return;

  const handleTooltipPosition = (iconElement: HTMLElement) => {
    // Pobierz pozycję ikony i modala
    const iconRect = iconElement.getBoundingClientRect();
    const modalContent = modal.querySelector(".modal-content") as HTMLElement;
    if (!modalContent) return;
    
    const modalContentRect = modalContent.getBoundingClientRect();
    
    // Oblicz pozycję ikony względem modal-content
    const iconLeftRelative = iconRect.left - modalContentRect.left;
    const iconCenterRelative = iconLeftRelative + iconRect.width / 2;
    
    // Parametry tooltipa
    const tooltipWidth = 250;
    const tooltipHalfWidth = tooltipWidth / 2;
    const modalPadding = 20;
    
    // Oblicz pozycję tooltipa (wyśrodkowany względem ikony)
    const tooltipCenter = iconCenterRelative;
    const tooltipLeft = tooltipCenter - tooltipHalfWidth;
    const tooltipRight = tooltipCenter + tooltipHalfWidth;
    
    // Sprawdź granice modala (modal-content)
    const minLeft = modalPadding;
    const maxRight = modalContentRect.width - modalPadding;
    
    // Oblicz pozycję tooltipa względem ikony (ikona jest position: relative)
    // Tooltip jest pozycjonowany względem ikony, więc left jest względem lewej krawędzi ikony
    const iconCenterInIcon = iconRect.width / 2; // Środek ikony względem siebie
    
    let tooltipLeftValue: string;
    let tooltipTransform: string;
    let arrowLeft: string;
    
    // Jeśli tooltip wychodzi poza lewą krawędź modala
    if (tooltipLeft < minLeft) {
      // Tooltip powinien zaczynać się od minLeft względem modal-content
      // Oblicz to względem ikony: minLeft - iconLeftRelative
      const tooltipLeftRelativeToIcon = minLeft - iconLeftRelative;
      tooltipLeftValue = `${tooltipLeftRelativeToIcon}px`;
      tooltipTransform = "none";
      arrowLeft = `${iconCenterInIcon}px`;
    }
    // Jeśli tooltip wychodzi poza prawą krawędź modala
    else if (tooltipRight > maxRight) {
      // Tooltip powinien kończyć się na maxRight względem modal-content
      // Oblicz lewą krawędź tooltipa: maxRight - tooltipWidth
      // Następnie oblicz to względem ikony
      const tooltipLeftInModal = maxRight - tooltipWidth;
      const tooltipLeftRelativeToIcon = tooltipLeftInModal - iconLeftRelative;
      tooltipLeftValue = `${tooltipLeftRelativeToIcon}px`;
      tooltipTransform = "none";
      arrowLeft = `${iconCenterInIcon}px`;
    }
    // Tooltip mieści się - wyśrodkuj
    else {
      tooltipLeftValue = "50%";
      tooltipTransform = "translateX(-50%)";
      arrowLeft = "50%";
    }
    
    // Ustaw pozycję tooltipa
    iconElement.style.setProperty("--tooltip-left", tooltipLeftValue);
    iconElement.style.setProperty("--tooltip-transform", tooltipTransform);
    iconElement.style.setProperty("--tooltip-arrow-left", arrowLeft);
  };

  // Znajdź wszystkie tooltips i dodaj listenery
  const tooltipIcons = modal.querySelectorAll(".tooltip-icon");
  tooltipIcons.forEach((icon) => {
    const iconElement = icon as HTMLElement;
    
    // Usuń poprzedni listener jeśli istnieje
    const existingHandler = (iconElement as any).__tooltipHandler;
    if (existingHandler) {
      iconElement.removeEventListener("mouseenter", existingHandler);
    }
    
    // Utwórz nowy handler
    const handler = () => {
      // Resetuj pozycję przed obliczeniem
      iconElement.style.setProperty("--tooltip-left", "50%");
      iconElement.style.setProperty("--tooltip-transform", "translateX(-50%)");
      iconElement.style.setProperty("--tooltip-arrow-left", "50%");
      
      // Oblicz i ustaw nową pozycję
      handleTooltipPosition(iconElement);
    };
    
    // Zapisz handler i dodaj listener
    (iconElement as any).__tooltipHandler = handler;
    iconElement.addEventListener("mouseenter", handler);
  });
}

// Ustaw listenery po załadowaniu DOM
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", setupTripModalListeners);
} else {
  setupTripModalListeners();
}

// Listenery są już ustawiane w setupTripModalListeners() i showDashboard()
