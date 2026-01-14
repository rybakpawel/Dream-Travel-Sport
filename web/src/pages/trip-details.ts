import { tripsApi } from "../api/client.js";
import { showLoading, hideLoading } from "../utils/loading.js";
import { notifications } from "../utils/notifications.js";
import { isTripInCart } from "../features/cart/operations.js";
import { loadCart } from "../features/cart/storage.js";
import { renderHotelStars } from "../utils/hotel-stars.js";

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
  tag: string;
  meta: string;
  details: string;
  extendedDescription: string; // Opis rozszerzony (HTML) - obowiązkowy, wyświetlany na stronie szczegółów
  priceCents: number | null; // Najtańsza cena z miejsc wylotu lub null
  departurePoints: DeparturePointDto[]; // Miejsca wylotu dla tego wyjazdu
  spotsLabel: string | null;
  useAutoSpotsLabel: boolean;
  capacity: number | null;
  seatsLeft: number | null;
  availability: string;
  heroImagePath: string | null;
  cardImagePath: string | null;
  startsAt: string | null;
  endsAt: string | null;
  hotelClass: number | null;
};

function formatPriceFromCents(cents: number): string {
  return `${(cents / 100).toLocaleString("pl-PL")} zł`;
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

function getAvailabilityText(
  trip: TripFromApi
): { text: string; class: string; isClosed: boolean } {
  const isClosed = trip.availability === "CLOSED" || trip.seatsLeft === 0;
  const isWaitlist = trip.availability === "WAITLIST";

  // Jeśli brak miejsc (0), zawsze pokazuj liczbę miejsc niezależnie od flagi
  if (isClosed && trip.capacity !== null && trip.seatsLeft !== null) {
    return {
      text: `${trip.seatsLeft}/${trip.capacity} miejsc`,
      class: "availability-closed",
      isClosed: true
    };
  } else if (isWaitlist) {
    return {
      text: "LISTA OCZEKUJĄCYCH",
      class: "availability-waitlist",
      isClosed: true
    };
  } else if (trip.useAutoSpotsLabel && trip.capacity !== null && trip.seatsLeft !== null) {
    return {
      text: `${trip.seatsLeft}/${trip.capacity} miejsc`,
      class: "availability-available",
      isClosed: false
    };
  } else {
    return {
      text: trip.spotsLabel || "Sprawdź dostępność",
      class: "availability-available",
      isClosed: false
    };
  }
}

async function loadTripDetails() {
  const urlParams = new URLSearchParams(window.location.search);
  const slug = urlParams.get("slug");

  if (!slug) {
    showError();
    return;
  }

  const loadingState = document.getElementById("loading-state");
  const errorState = document.getElementById("error-state");
  const tripDetails = document.getElementById("trip-details");

  try {
    const trip = (await tripsApi.getBySlug(slug)) as TripFromApi;

    console.log("Loaded trip from API:", trip);

    if (!trip) {
      showError();
      return;
    }

    // Hide loading, show trip details
    if (loadingState) loadingState.style.display = "none";
    if (errorState) errorState.style.display = "none";
    if (tripDetails) tripDetails.style.display = "block";

    // Render trip data
    renderTripDetails(trip);
  } catch (err) {
    console.error("Failed to load trip details:", err);
    showError();
  }
}

function showError() {
  const loadingState = document.getElementById("loading-state");
  const errorState = document.getElementById("error-state");
  const tripDetails = document.getElementById("trip-details");

  if (loadingState) loadingState.style.display = "none";
  if (errorState) errorState.style.display = "block";
  if (tripDetails) tripDetails.style.display = "none";
}

// Global state dla wybranego miejsca wylotu
let selectedDeparturePoint: DeparturePointDto | null = null;
let currentTrip: TripFromApi | null = null;

function renderTripDetails(trip: TripFromApi) {
  console.log("Rendering trip details:", trip);
  currentTrip = trip;

  // Hero image
  const heroImage = document.getElementById("trip-hero-image");
  const imagePath = trip.heroImagePath || trip.cardImagePath || "assets/images/hero-empty.jpg";
  if (heroImage) {
    heroImage.style.backgroundImage = `linear-gradient(to top, rgba(0,0,0,0.85), rgba(0,0,0,0.25)), url('${imagePath}')`;
  }

  // Tag
  const tagEl = document.getElementById("trip-tag");
  if (tagEl && trip.tag) {
    tagEl.textContent = trip.tag;
    tagEl.style.display = "block";
  } else if (tagEl) {
    tagEl.style.display = "none";
  }

  // Title
  const titleEl = document.getElementById("trip-title");
  if (titleEl && trip.name) {
    titleEl.textContent = trip.name;
  }

  // Meta
  const metaEl = document.getElementById("trip-meta");
  if (metaEl && trip.meta) {
    metaEl.textContent = trip.meta;
    metaEl.style.display = "block";
  } else if (metaEl) {
    metaEl.style.display = "none";
  }

  // Date
  const dateEl = document.getElementById("trip-date");
  const tripDate = formatTripDate(trip.startsAt, trip.endsAt);
  if (dateEl) {
    if (tripDate) {
      dateEl.textContent = tripDate;
      dateEl.style.display = "block";
    } else {
      dateEl.style.display = "none";
    }
  }

  // Description - zawsze używaj extendedDescription (jest obowiązkowe)
  const descriptionEl = document.getElementById("trip-description");
  if (descriptionEl) {
    console.log("Extended description:", trip.extendedDescription);
    if (trip.extendedDescription && trip.extendedDescription.trim() !== "") {
      // extendedDescription jest już HTML - wyświetl bezpośrednio
      descriptionEl.innerHTML = trip.extendedDescription;
    } else {
      // Fallback jeśli extendedDescription jest puste (może być podczas migracji)
      descriptionEl.innerHTML = trip.details ? `<p>${trip.details.replace(/\n/g, '</p><p>')}</p>` : "";
    }
  }

  // Renderuj miejsca wylotu i wybór miasta
  renderDeparturePointsSelect(trip.departurePoints || []);

  // Renderuj klasę hotelu
  renderHotelClass(trip.hotelClass);

  // Ustaw początkową cenę (najtańsza z miejsc wylotu lub fallback do priceCents)
  updatePriceFromSelectedDeparturePoint(trip);

  // Availability
  const availabilityEl = document.getElementById("trip-availability");
  const availability = getAvailabilityText(trip);
  if (availabilityEl) {
    availabilityEl.textContent = availability.text;
    availabilityEl.className = `availability-value ${availability.class}`;
  }

  // CTA Button - teraz jako button zamiast linka (dodawanie do koszyka wymaga wyboru miejsca wylotu)
  const addToCartBtn = document.getElementById("add-to-cart-btn") as HTMLButtonElement;
  if (addToCartBtn) {
    if (availability.isClosed) {
      addToCartBtn.textContent = "Brak miejsc";
      addToCartBtn.disabled = true;
      addToCartBtn.classList.add("btn-disabled");
    } else {
      // Sprawdź, czy wyjazd jest już w koszyku
      const cart = loadCart();
      const isInCart = trip.departurePoints && trip.departurePoints.length > 0 && selectedDeparturePoint
        ? isTripInCart(cart, trip.slug, selectedDeparturePoint.id)
        : isTripInCart(cart, trip.slug);
      
      if (isInCart) {
        addToCartBtn.textContent = "W koszyku";
        addToCartBtn.disabled = true;
        addToCartBtn.classList.add("btn-disabled");
      } else {
        addToCartBtn.textContent = "Do koszyka";
        // Jeśli są miejsca wylotu, wyłącz przycisk do momentu wyboru miejsca wylotu
        if (trip.departurePoints && trip.departurePoints.length > 0) {
          addToCartBtn.disabled = !selectedDeparturePoint;
        } else {
          addToCartBtn.disabled = false;
        }
        addToCartBtn.classList.remove("btn-disabled");
      }
    }
  }

  // Ustaw listener dla przycisku "Do koszyka"
  setupAddToCartListener(trip);
}

function renderDeparturePointsSelect(departurePoints: DeparturePointDto[]) {
  const container = document.getElementById("departure-point-select-container");
  const existingSelect = document.getElementById("departure-point-select") as HTMLSelectElement;
  
  if (!container) return;

  // Jeśli brak miejsc wylotu, ukryj select
  if (!departurePoints || departurePoints.length === 0) {
    container.style.display = "none";
    // Jeśli brak miejsc wylotu, użyj starej ceny (fallback)
    if (currentTrip && currentTrip.priceCents !== null && currentTrip.priceCents !== undefined) {
      updatePrice(currentTrip.priceCents);
    }
    return;
  }

  // Pokaż select
  container.style.display = "block";

  // Sortuj miejsca wylotu po sortOrder
  const sortedDeparturePoints = [...departurePoints].sort((a, b) => a.sortOrder - b.sortOrder);

  // Utwórz nowy select (zastępując istniejący, żeby usunąć stare listenery)
  const select = document.createElement("select");
  select.id = "departure-point-select";
  select.className = "departure-point-select";
  select.required = true;

  // Dodaj opcje do selecta
  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "Wybierz miejsce wylotu";
  select.appendChild(defaultOption);

  sortedDeparturePoints.forEach((dp) => {
    const option = document.createElement("option");
    option.value = dp.id;
    option.textContent = `${dp.city} - ${formatPriceFromCents(dp.priceCents)}`;
    option.setAttribute("data-price-cents", String(dp.priceCents));
    select.appendChild(option);
  });

  // Zastąp istniejący select nowym
  if (existingSelect) {
    existingSelect.replaceWith(select);
  } else {
    container.appendChild(select);
  }

  // Ustaw listener dla zmiany wyboru miejsca wylotu
  select.addEventListener("change", (e) => {
    const selectedId = (e.target as HTMLSelectElement).value;
    if (!selectedId) {
      selectedDeparturePoint = null;
      updatePriceFromSelectedDeparturePoint(currentTrip!);
      
      // Wyłącz przycisk "Do koszyka" jeśli nie wybrano miejsca wylotu
      const addToCartBtn = document.getElementById("add-to-cart-btn") as HTMLButtonElement;
      if (addToCartBtn) {
        addToCartBtn.disabled = true;
      }
      return;
    }

    const selectedOption = select.querySelector(`option[value="${selectedId}"]`) as HTMLOptionElement;
    if (selectedOption) {
      const priceCents = parseInt(selectedOption.getAttribute("data-price-cents") || "0", 10);
      selectedDeparturePoint = sortedDeparturePoints.find((dp) => dp.id === selectedId) || null;
      updatePrice(priceCents);
      
      // Sprawdź, czy wyjazd jest już w koszyku i zaktualizuj przycisk
      const addToCartBtn = document.getElementById("add-to-cart-btn") as HTMLButtonElement;
      if (addToCartBtn && currentTrip) {
        const cart = loadCart();
        const isInCart = isTripInCart(cart, currentTrip.slug, selectedDeparturePoint?.id);
        if (isInCart) {
          addToCartBtn.textContent = "W koszyku";
          addToCartBtn.disabled = true;
          addToCartBtn.classList.add("btn-disabled");
        } else {
          addToCartBtn.textContent = "Do koszyka";
          addToCartBtn.disabled = false;
          addToCartBtn.classList.remove("btn-disabled");
        }
      }
    }
  });

  // Automatycznie wybierz pierwsze miejsce wylotu (jeśli istnieje)
  if (sortedDeparturePoints.length > 0) {
    select.value = sortedDeparturePoints[0].id;
    selectedDeparturePoint = sortedDeparturePoints[0];
    updatePrice(sortedDeparturePoints[0].priceCents);
    
    // Sprawdź, czy wyjazd jest już w koszyku i zaktualizuj przycisk
    const addToCartBtn = document.getElementById("add-to-cart-btn") as HTMLButtonElement;
    if (addToCartBtn && currentTrip && !getAvailabilityText(currentTrip).isClosed) {
      const cart = loadCart();
      const isInCart = isTripInCart(cart, currentTrip.slug, selectedDeparturePoint?.id);
      if (isInCart) {
        addToCartBtn.textContent = "W koszyku";
        addToCartBtn.disabled = true;
        addToCartBtn.classList.add("btn-disabled");
      } else {
        addToCartBtn.textContent = "Do koszyka";
        addToCartBtn.disabled = false;
        addToCartBtn.classList.remove("btn-disabled");
      }
    }
  }
}

function updatePrice(priceCents: number) {
  const priceEl = document.getElementById("trip-price");
  if (priceEl) {
    priceEl.textContent = formatPriceFromCents(priceCents);
  }
}

function updatePriceFromSelectedDeparturePoint(trip: TripFromApi) {
  if (selectedDeparturePoint) {
    // Użyj wybranego miejsca wylotu
    updatePrice(selectedDeparturePoint.priceCents);
  } else if (trip.departurePoints && trip.departurePoints.length > 0) {
    // Użyj najtańszej ceny z miejsc wylotu
    const minPrice = Math.min(...trip.departurePoints.map((dp) => dp.priceCents));
    updatePrice(minPrice);
  } else if (trip.priceCents !== null && trip.priceCents !== undefined) {
    // Fallback do starej ceny (kompatybilność wsteczna)
    updatePrice(trip.priceCents);
  } else {
    // Brak ceny
    const priceEl = document.getElementById("trip-price");
    if (priceEl) {
      priceEl.textContent = "Brak ceny";
    }
  }
}

function setupAddToCartListener(trip: TripFromApi) {
  const addToCartBtn = document.getElementById("add-to-cart-btn") as HTMLButtonElement;
  if (!addToCartBtn) return;

  // Usuń poprzedni listener jeśli istnieje
  const newBtn = addToCartBtn.cloneNode(true) as HTMLButtonElement;
  addToCartBtn.parentNode?.replaceChild(newBtn, addToCartBtn);

  newBtn.addEventListener("click", () => {
    // Walidacja - wymagany wybór miejsca wylotu (jeśli są miejsca wylotu)
    if (trip.departurePoints && trip.departurePoints.length > 0) {
      if (!selectedDeparturePoint) {
        const select = document.getElementById("departure-point-select") as HTMLSelectElement;
        if (select) {
          select.focus();
          select.reportValidity(); // Pokaż walidację HTML5
        }
        return;
      }
    }

    // Dodaj wyjazd do koszyka z wybranym miejscem wylotu
    addTripToCart(trip);
  });
}

async function addTripToCart(trip: TripFromApi) {
  console.log("Adding trip to cart:", trip, "with departure point:", selectedDeparturePoint);
  
  try {
    // Import funkcji koszyka
    const { addTrip } = await import("../features/cart/operations.js");
    const { loadCart, saveCart } = await import("../features/cart/storage.js");
    
    // Załaduj obecny koszyk
    const cart = loadCart();
    
    // Przygotuj parametry dla addTrip
    const tripId = trip.slug; // używamy slug jako ID (tak jak w starym kodzie)
    const departurePointId = selectedDeparturePoint?.id;
    const priceCents = selectedDeparturePoint?.priceCents;
    
    // Dodaj wyjazd do koszyka z miejscem wylotu i ceną
    const updatedCart = addTrip(cart, tripId, departurePointId, priceCents);
    
    // Zapisz zaktualizowany koszyk
    saveCart(updatedCart);
    
    // Pokaż powiadomienie o sukcesie
    notifications.success(`Wyjazd "${trip.name}" został dodany do koszyka`);
    
    // Przekieruj do koszyka po krótkim opóźnieniu, żeby użytkownik zobaczył powiadomienie
    setTimeout(() => {
      window.location.href = "koszyk.html";
    }, 500);
  } catch (err) {
    console.error("Failed to add trip to cart:", err);
    notifications.error("Nie udało się dodać wyjazdu do koszyka");
  }
}

function renderHotelClass(hotelClass: number | null) {
  const container = document.getElementById("trip-hotel-class-container");
  const starsDisplay = document.getElementById("trip-hotel-class-stars");
  
  if (!container || !starsDisplay) return;

  if (hotelClass && hotelClass >= 1 && hotelClass <= 5) {
    starsDisplay.innerHTML = renderHotelStars(hotelClass);
    container.style.display = "block";
  } else {
    container.style.display = "none";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  loadTripDetails();
});

