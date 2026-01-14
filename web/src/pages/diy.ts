import { tripsApi } from "../api/client.js";
import { showSectionLoading, hideSectionLoading } from "../utils/loading.js";

type TripFromApi = {
  id: string;
  slug: string;
  name: string;
  tag: string;
  details: string;
  priceCents: number;
  spotsLabel: string | null;
  useAutoSpotsLabel: boolean;
  capacity: number | null;
  seatsLeft: number | null;
  availability: string;
  cardImagePath: string | null;
  startsAt: string | null;
  endsAt: string | null;
};

function formatPriceFromCents(cents: number): string {
  return `od ${(cents / 100).toLocaleString("pl-PL")} zł / os.`;
}

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

async function renderDiyTrips() {
  const grid = document.querySelector<HTMLElement>("#okazje .grid");
  const okazjeSection = document.getElementById("okazje");
  if (!grid) return;

  // Pokaż loading state
  if (okazjeSection) {
    showSectionLoading(okazjeSection, "Ładowanie wyjazdów...");
  }

  try {
    const response = await tripsApi.getAll();
    const trips = ((response as any).data || response) as TripFromApi[];

    // Ukryj loading state
    if (okazjeSection) {
      hideSectionLoading(okazjeSection);
    }

    // Wyczyść istniejące karty
    grid.innerHTML = "";

    if (trips.length === 0) {
      // Pokaż placeholder gdy brak wyjazdów
      const emptyState = document.createElement("div");
      emptyState.className = "empty-state";
      emptyState.style.cssText = `
        grid-column: 1 / -1;
        text-align: center;
        padding: 60px 20px;
        color: var(--dt-muted);
      `;
      emptyState.innerHTML = `
        <h3 style="color: var(--dt-light); margin-bottom: 16px; font-size: 24px;">Brak dostępnych wyjazdów</h3>
        <p style="margin-bottom: 24px; max-width: 500px; margin-left: auto; margin-right: auto;">
          Wkrótce pojawią się nowe terminy wyjazdów. Zapisz się do newslettera, aby otrzymać informację o nowych ofertach.
        </p>
        <a href="index.html#kontakt" class="btn-primary" style="display: inline-block;">Zapisz się do newslettera</a>
      `;
      grid.appendChild(emptyState);
      return;
    }

    trips.forEach((trip) => {
      const article = document.createElement("article");
      article.className = "card";

      const imagePath = trip.cardImagePath || "assets/images/hero-empty.jpg";
      let spots: string;
      let spotsClass = "pill-small";
      const isClosed = trip.availability === "CLOSED" || trip.seatsLeft === 0;
      const isWaitlist = trip.availability === "WAITLIST";
      
      // Jeśli brak miejsc (0), zawsze pokazuj liczbę miejsc niezależnie od flagi
      if (isClosed && trip.capacity !== null && trip.seatsLeft !== null) {
        spots = `${trip.seatsLeft}/${trip.capacity} miejsc`;
        spotsClass = "pill-small";
      } else if (isWaitlist) {
        spots = "LISTA OCZEKUJĄCYCH";
        spotsClass = "pill-small pill-waitlist";
      } else if (trip.useAutoSpotsLabel && trip.capacity !== null && trip.seatsLeft !== null) {
        spots = `${trip.seatsLeft}/${trip.capacity} miejsc`;
      } else {
        spots = trip.spotsLabel || "Sprawdź dostępność";
      }

      // Gdy brak miejsc, pokaż chip "Brak miejsc" zamiast przycisku "Do koszyka"
      const ctaButton = isClosed
        ? `<span class="pill-small pill-closed">Brak miejsc</span>`
        : isWaitlist
        ? ""
        : `<a class="pill-cta" href="koszyk.html?trip=${trip.slug}">Do koszyka</a>`;

      const tripDate = formatTripDate(trip.startsAt, trip.endsAt);
      
      article.innerHTML = `
        <figure class="card-image">
          <img src="${imagePath}" alt="${trip.name}">
          <div class="card-tag">${trip.tag}</div>
        </figure>
        <h3>${trip.name}</h3>
        ${tripDate ? `<div class="card-date">${tripDate}</div>` : ""}
        <p>${trip.details}</p>
        <div class="price-row">
          <span class="price">${formatPriceFromCents(trip.priceCents)}</span>
          <div class="price-actions">
            <span class="${spotsClass}">${spots}</span>
            ${ctaButton}
          </div>
        </div>
      `;

      grid.appendChild(article);
    });
  } catch (err) {
    console.error("Failed to load trips from API:", err);
    // Pokaż komunikat błędu
    grid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1; text-align: center; padding: 60px 20px; color: var(--dt-muted);">
        <h3 style="color: var(--dt-light); margin-bottom: 16px; font-size: 24px;">Nie udało się załadować wyjazdów</h3>
        <p style="margin-bottom: 24px; max-width: 500px; margin-left: auto; margin-right: auto;">
          Wystąpił problem z połączeniem. Spróbuj odświeżyć stronę lub skontaktuj się z nami.
        </p>
        <a href="index.html#kontakt" class="btn-primary" style="display: inline-block;">Skontaktuj się z nami</a>
      </div>
    `;
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  await renderDiyTrips();
});


