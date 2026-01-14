import { tripsApi } from "../../api/client.js";
import { showSectionLoading, hideSectionLoading } from "../../utils/loading.js";
import { notifications } from "../../utils/notifications.js";
import type { Cart } from "./types.js";
import { MAX_QTY_PER_TRIP } from "./storage.js";
import { renderHotelStars } from "../../utils/hotel-stars.js";

type DeparturePointDto = {
  id: string;
  city: string;
  priceCents: number;
  currency: string;
  sortOrder: number;
};

type TripFromApi = {
  id: string;
  slug: string;
  name: string;
  details: string;
  priceCents: number | null; // Najtańsza cena z miejsc wylotu lub null
  departurePoints?: DeparturePointDto[]; // Miejsca wylotu dla tego wyjazdu (zawsze zwracane przez API)
  capacity: number | null;
  seatsLeft: number | null;
  availability: string;
  startsAt: string | null;
  endsAt: string | null;
  hotelClass: number | null;
};

export type RenderCartParams = {
  cart: Cart;
  onQtyChange: (index: number, qty: number) => void;
  onRemoveItem?: (index: number) => void;
};

function formatTripDate(startsAt: string | null, endsAt: string | null): string {
  if (!startsAt || !endsAt) return "";

  const start = new Date(startsAt);
  const end = new Date(endsAt);

  const startDay = start.getDate();
  const startMonth = start.toLocaleDateString("pl-PL", { month: "long" });
  const startYear = start.getFullYear();

  const endDay = end.getDate();
  const endMonth = end.toLocaleDateString("pl-PL", { month: "long" });
  const endYear = end.getFullYear();

  // Jeśli ten sam miesiąc i rok
  if (startMonth === endMonth && startYear === endYear) {
    if (startDay === endDay) {
      // Ten sam dzień
      return `${startDay} ${startMonth} ${startYear}`;
    } else {
      // Różne dni, ten sam miesiąc
      return `${startDay}-${endDay} ${startMonth} ${startYear}`;
    }
  } else if (startYear === endYear) {
    // Różne miesiące, ten sam rok
    return `${startDay} ${startMonth} - ${endDay} ${endMonth} ${startYear}`;
  } else {
    // Różne lata
    return `${startDay} ${startMonth} ${startYear} - ${endDay} ${endMonth} ${endYear}`;
  }
}

export async function renderCart({ cart, onQtyChange, onRemoveItem }: RenderCartParams) {
  const body = document.getElementById("cart-body");
  const totalPeopleEl = document.getElementById("cart-total-people");
  const totalPriceEl = document.getElementById("cart-total-price");
  const passengersList = document.getElementById("passengers-list");
  const checkoutForms = document.getElementById("checkout-forms");
  const passengersSection = document.getElementById("passengers-section");
  const cartCard = document.getElementById("cart-card");
  const cartEmptyMessage = document.getElementById("cart-empty-message");
  const cartTable = document.getElementById("cart-table");
  const cartSummary = document.getElementById("cart-summary");

  if (!body || !totalPeopleEl || !totalPriceEl || !passengersList) return;

  body.innerHTML = "";
  passengersList.innerHTML = "";

  if (!cart.length) {
    // Pokaż komunikat o pustym koszyku
    if (cartEmptyMessage) cartEmptyMessage.style.display = "block";
    // Ukryj tabelę i summary
    if (cartTable) (cartTable as HTMLElement).style.display = "none";
    if (cartSummary) (cartSummary as HTMLElement).style.display = "none";
    // Ukryj formularze i sekcje
    if (checkoutForms) checkoutForms.style.display = "none";
    if (passengersSection) passengersSection.style.display = "none";

    totalPeopleEl.textContent = "0";
    (totalPriceEl as HTMLElement).dataset.totalCents = "0";
    totalPriceEl.textContent = "0 zł";
    return;
  }

  // Ukryj komunikat o pustym koszyku
  if (cartEmptyMessage) cartEmptyMessage.style.display = "none";
  // Pokaż tabelę i summary
  if (cartTable) (cartTable as HTMLElement).style.display = "";
  if (cartSummary) (cartSummary as HTMLElement).style.display = "";
  // Pokaż formularze i sekcje gdy koszyk ma elementy
  if (checkoutForms) checkoutForms.style.display = "";
  if (passengersSection) passengersSection.style.display = "";

  let totalPeople = 0;
  let totalPriceCents = 0;

  // Przechowaj informacje o wyjazdach dla renderowania formularzy uczestników
  const tripsData: Array<{ trip: TripFromApi; item: typeof cart[0]; index: number }> = [];

  // Pobierz dane wyjazdów z API
  for (let index = 0; index < cart.length; index++) {
    const item = cart[index];
    if (!item.id) continue;

    let trip: TripFromApi | null = null;

    try {
      // Pobierz z API (używamy slug)
      trip = (await tripsApi.getBySlug(item.id)) as TripFromApi;
    } catch (err) {
      console.error(`Failed to load trip ${item.id} from API:`, err);
      // Jeśli nie udało się pobrać z API, pomiń ten element
      continue;
    }

    if (!trip) continue;

    // Zapisz dane wyjazdu dla późniejszego renderowania formularzy
    tripsData.push({ trip, item, index });

    const row = document.createElement("tr");

    const tdName = document.createElement("td");
    tdName.setAttribute("data-label", "Wyjazd");
    tdName.textContent = trip.name;

    // Kolumna "Termin"
    const tdTermin = document.createElement("td");
    tdTermin.setAttribute("data-label", "Termin");
    const tripDate = formatTripDate(trip.startsAt, trip.endsAt);
    tdTermin.textContent = tripDate || "-";

    // Kolumna "Wylot"
    const tdWylot = document.createElement("td");
    tdWylot.setAttribute("data-label", "Wylot");
    if (item.departurePointId && trip.departurePoints && trip.departurePoints.length > 0) {
      const departurePoint = trip.departurePoints.find((dp) => dp.id === item.departurePointId);
      if (departurePoint) {
        tdWylot.textContent = departurePoint.city;
      } else {
        tdWylot.textContent = "-";
      }
    } else {
      tdWylot.textContent = "-";
    }

    // Kolumna "Klasa hotelu"
    const tdHotelClass = document.createElement("td");
    tdHotelClass.setAttribute("data-label", "Klasa hotelu");
    tdHotelClass.innerHTML = renderHotelStars(trip.hotelClass);

    const tdQty = document.createElement("td");
    tdQty.setAttribute("data-label", "Ilość osób");
    const select = document.createElement("select");
    select.className = "qty-select";

    // Oblicz maksymalną dostępną ilość (uwzględniając dostępność miejsc)
    const maxAvailable =
      trip.capacity !== null && trip.seatsLeft !== null
        ? Math.min(MAX_QTY_PER_TRIP, trip.seatsLeft + item.qty) // + item.qty bo już jest w koszyku
        : MAX_QTY_PER_TRIP;

    for (let i = 1; i <= maxAvailable; i++) {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = String(i);
      if (i === item.qty) opt.selected = true;
      // Oznacz opcje, które przekraczają dostępność
      if (trip.capacity !== null && trip.seatsLeft !== null && i > trip.seatsLeft + item.qty) {
        opt.disabled = true;
        opt.textContent += " (brak miejsc)";
      }
      select.appendChild(opt);
    }

    select.addEventListener("change", async () => {
      const newQty = parseInt(select.value, 10);
      // Sprawdź dostępność przed zmianą ilości
      if (trip.capacity !== null && trip.seatsLeft !== null) {
        const currentQtyInCart = item.qty;
        const requestedQty = newQty;
        const availableAfterRemoving = trip.seatsLeft + currentQtyInCart; // miejsca zwolnione z obecnej ilości

        if (requestedQty > availableAfterRemoving) {
          notifications.error(
            `Wyjazd "${trip.name}" ma tylko ${availableAfterRemoving} dostępnych miejsc. Nie można zarezerwować ${requestedQty} miejsc.`
          );
          // Przywróć poprzednią wartość
          select.value = String(item.qty);
          return;
        }
      }
      onQtyChange(index, newQty);
    });
    tdQty.appendChild(select);

    const tdPrice = document.createElement("td");
    tdPrice.setAttribute("data-label", "Cena");
    // Użyj zapisanej ceny z koszyka (jeśli dostępna), w przeciwnym razie użyj ceny z API
    let itemPriceCents: number | null = null;
    let linePriceCents = 0;
    
    if (item.priceCents !== undefined && item.priceCents !== null && item.priceCents > 0) {
      // Użyj zapisanej ceny z koszyka (z wybranego miejsca wylotu)
      itemPriceCents = item.priceCents;
    } else if (trip.priceCents !== null && trip.priceCents !== undefined && trip.priceCents > 0) {
      // Fallback do ceny z API (najtańsza z miejsc wylotu lub stara cena)
      itemPriceCents = trip.priceCents;
    }
    
    if (itemPriceCents === null || itemPriceCents === 0) {
      // Brak ceny - wyświetl "Cena do uzgodnienia"
      tdPrice.textContent = "Cena do uzgodnienia";
      tdPrice.style.fontStyle = "italic";
      tdPrice.style.color = "var(--dt-muted)";
      linePriceCents = 0; // Nie dodawaj do sumy
    } else {
      linePriceCents = itemPriceCents * item.qty;
      tdPrice.textContent = (linePriceCents / 100).toLocaleString("pl-PL") + " zł";
      tdPrice.style.fontStyle = "normal";
      tdPrice.style.color = "";
    }

    // Kolumna "Usuń"
    const tdRemove = document.createElement("td");
    if (onRemoveItem) {
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.textContent = "×";
      removeBtn.style.cssText = "background: transparent; border: none; color: var(--dt-muted); font-size: 24px; cursor: pointer; padding: 0 8px; line-height: 1;";
      removeBtn.title = "Usuń z koszyka";
      removeBtn.addEventListener("click", () => {
        if (confirm(`Czy na pewno chcesz usunąć "${trip.name}" z koszyka?`)) {
          onRemoveItem(index);
        }
      });
      removeBtn.addEventListener("mouseenter", () => {
        removeBtn.style.color = "#ff4444";
      });
      removeBtn.addEventListener("mouseleave", () => {
        removeBtn.style.color = "var(--dt-muted)";
      });
      tdRemove.appendChild(removeBtn);
    }

    row.appendChild(tdName);
    row.appendChild(tdTermin);
    row.appendChild(tdWylot);
    row.appendChild(tdHotelClass);
    row.appendChild(tdQty);
    row.appendChild(tdPrice);
    row.appendChild(tdRemove);
    body.appendChild(row);

    // Dodaj do sumy osób niezależnie od ceny
    totalPeople += item.qty;
    // Dodaj do sumy ceny (linePriceCents może być 0 jeśli brak ceny)
    totalPriceCents += linePriceCents;
  }

  totalPeopleEl.textContent = String(totalPeople);
  // Ustaw sumę w groszach jako źródło prawdy (używane m.in. do wyliczeń Dream Points w UI)
  (totalPriceEl as HTMLElement).dataset.totalCents = String(totalPriceCents);
  totalPriceEl.textContent = (totalPriceCents / 100).toLocaleString("pl-PL") + " zł";

  // Ukryj loading state po zakończeniu
  if (cartCard) {
    hideSectionLoading(cartCard);
  }

  // Wygeneruj formularze uczestników - każdy wyjazd ma swoją sekcję
  for (const { trip, item, index } of tripsData) {
    // Utwórz sekcję dla tego wyjazdu
    const itemSection = document.createElement("div");
    itemSection.className = "passengers-item-section";
    itemSection.setAttribute("data-item-index", String(index));

    // Nagłówek sekcji z informacjami o wyjeździe
    const sectionHeader = document.createElement("div");
    sectionHeader.className = "passengers-item-header";
    
    // Przygotuj informacje o wyjeździe
    const tripDate = formatTripDate(trip.startsAt, trip.endsAt);
    let departureCity = "-";
    if (item.departurePointId && trip.departurePoints && trip.departurePoints.length > 0) {
      const departurePoint = trip.departurePoints.find((dp) => dp.id === item.departurePointId);
      if (departurePoint) {
        departureCity = departurePoint.city;
      }
    }
    
    sectionHeader.innerHTML = `
      <h3 class="passengers-item-title">${trip.name}</h3>
      <div class="passengers-item-meta">
        ${tripDate ? `<span>${tripDate}</span>` : ""}
        ${departureCity !== "-" ? `<span>Wylot: ${departureCity}</span>` : ""}
        <span>Liczba uczestników: ${item.qty}</span>
      </div>
    `;
    itemSection.appendChild(sectionHeader);

    // Kontener dla kart uczestników
    const passengersContainer = document.createElement("div");
    passengersContainer.className = "passengers-item-cards";

    // Wygeneruj formularze uczestników dla tego wyjazdu
    for (let passengerIndex = 0; passengerIndex < item.qty; passengerIndex++) {
      const card = document.createElement("div");
      card.className = "passenger-card";
      card.setAttribute("data-item-index", String(index));
      card.setAttribute("data-passenger-index", String(passengerIndex));
      card.innerHTML = `
        <div class="passenger-card-title">Uczestnik ${passengerIndex + 1}</div>
        <div class="field-group">
          <label>Imię <span style="color: var(--dt-gold)">*</span></label>
          <input type="text" name="item-${index}-passenger-${passengerIndex}-firstName" placeholder="np. Jan" required>
        </div>
        <div class="field-group">
          <label>Nazwisko <span style="color: var(--dt-gold)">*</span></label>
          <input type="text" name="item-${index}-passenger-${passengerIndex}-lastName" placeholder="np. Nowak" required>
        </div>
        <div class="field-group">
          <label>Data urodzenia <span style="color: var(--dt-gold)">*</span></label>
          <input type="date" name="item-${index}-passenger-${passengerIndex}-birthDate" max="${new Date().toISOString().split("T")[0]}" required>
        </div>
        <div class="field-group">
          <label>Typ dokumentu <span style="color: var(--dt-gold)">*</span></label>
          <select name="item-${index}-passenger-${passengerIndex}-documentType" required>
            <option value="ID_CARD">Dowód osobisty</option>
            <option value="PASSPORT">Paszport</option>
          </select>
        </div>
        <div class="field-group">
          <label>Numer dokumentu (dowód / paszport) <span style="color: var(--dt-gold)">*</span></label>
          <input type="text" name="item-${index}-passenger-${passengerIndex}-documentNumber" placeholder="seria i numer" required>
        </div>
      `;
      passengersContainer.appendChild(card);
    }

    itemSection.appendChild(passengersContainer);
    passengersList.appendChild(itemSection);
  }
}
