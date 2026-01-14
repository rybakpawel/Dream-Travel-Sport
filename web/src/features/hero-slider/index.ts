import { tripsApi } from "../../api/client.js";
import { showSectionLoading, hideSectionLoading } from "../../utils/loading.js";

type TripFromApi = {
  id: string;
  slug: string;
  name: string;
  tag: string;
  meta: string;
  priceCents: number | null; // Najtańsza cena z miejsc wylotu lub null (fallback do starej ceny)
  spotsLabel: string | null;
  useAutoSpotsLabel: boolean;
  capacity: number | null;
  seatsLeft: number | null;
  availability: string;
  heroImagePath: string | null;
  cardImagePath: string | null;
  startsAt: string | null;
  endsAt: string | null;
};

function formatPriceFromCents(cents: number | null): string {
  if (cents === null || cents === undefined) {
    return "Cena do uzgodnienia";
  }
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

export async function initHeroSlider() {
  const heroVisual = document.getElementById("hero-visual") as HTMLElement | null;
  const heroTag = document.getElementById("hero-tag");
  const heroMatch = document.getElementById("hero-match");
  const heroMeta = document.getElementById("hero-meta");
  const heroSpots = document.getElementById("hero-spots");
  const heroPrice = document.getElementById("hero-price");
  const heroCta = document.getElementById("hero-cta") as HTMLAnchorElement | null;
  const heroPrev = document.getElementById("hero-prev") as HTMLButtonElement | null;
  const heroNext = document.getElementById("hero-next") as HTMLButtonElement | null;
  const heroDotsWrap = document.getElementById("hero-dots");

  if (
    !heroVisual ||
    !heroTag ||
    !heroMatch ||
    !heroMeta ||
    !heroSpots ||
    !heroPrice ||
    !heroCta ||
    !heroPrev ||
    !heroNext ||
    !heroDotsWrap
  ) {
    return;
  }

  // TS narrow: używamy stałych z non-null po guardzie, bo są wykorzystywane w closure (renderHeroSlide)
  const heroVisualEl = heroVisual;
  const heroTagEl = heroTag;
  const heroMatchEl = heroMatch;
  const heroDateEl = document.getElementById("hero-date");
  const heroMetaEl = heroMeta;
  const heroSpotsEl = heroSpots;
  const heroPriceEl = heroPrice;
  const heroCtaEl = heroCta;
  const heroPrevEl = heroPrev;
  const heroNextEl = heroNext;
  const heroDotsWrapEl = heroDotsWrap;

  // Get hero overlay for click handling
  const heroVisualOverlay = heroVisualEl.querySelector(".hero-visual-overlay") as HTMLElement | null;

  // Pokaż loading state i ukryj zawartość hero
  showSectionLoading(heroVisualEl, "Ładowanie wyjazdów...");
  // Ukryj zawartość overlay podczas ładowania
  if (heroVisualOverlay) {
    heroVisualOverlay.style.opacity = "0";
  }

  // Pobierz wyróżnione wyjazdy z API (fallback do lokalnych danych)
  let slides: Array<{
    id: string;
    tag: string;
    name: string;
    date: string;
    meta: string;
    price: string;
    spots: string;
    spotsClass: string;
    image: string;
    ctaHref: string;
    ctaText: string;
    isClosed: boolean;
  }> = [];

  try {
    const featuredTrips = (await tripsApi.getFeatured()) as TripFromApi[];
    slides = featuredTrips.map((trip) => {
      let spots: string;
      let spotsClass = "pill";
      const isClosed = trip.availability === "CLOSED" || trip.seatsLeft === 0;
      const isWaitlist = trip.availability === "WAITLIST";
      
      // Jeśli brak miejsc (0), zawsze pokazuj liczbę miejsc niezależnie od flagi
      if (isClosed && trip.capacity !== null && trip.seatsLeft !== null) {
        spots = `${trip.seatsLeft}/${trip.capacity} miejsc`;
        spotsClass = "pill";
      } else if (isWaitlist) {
        spots = "LISTA OCZEKUJĄCYCH";
        spotsClass = "pill pill-waitlist";
      } else if (trip.useAutoSpotsLabel && trip.capacity !== null && trip.seatsLeft !== null) {
        spots = `${trip.seatsLeft}/${trip.capacity} miejsc`;
      } else {
        spots = trip.spotsLabel || "Sprawdź dostępność";
      }

      const tripDate = formatTripDate(trip.startsAt, trip.endsAt);
      
      return {
        id: trip.id,
        tag: trip.tag,
        name: trip.name,
        date: tripDate,
        meta: trip.meta,
        price: formatPriceFromCents(trip.priceCents),
        spots,
        spotsClass,
        image: trip.heroImagePath || "assets/images/hero-empty.jpg",
        ctaHref: `trip-details.html?slug=${trip.slug}`,
        ctaText: isClosed ? "Zobacz szczegóły" : "Zobacz szczegóły",
        isClosed: isClosed || isWaitlist
      };
    });
  } catch (err) {
    console.error("Failed to load featured trips from API:", err);
    // Brak fallbacku - jeśli API nie działa, slides pozostanie pusty
    slides = [];
  } finally {
    // Ukryj loading state nawet jeśli wystąpił błąd
    hideSectionLoading(heroVisualEl);
    // Pokaż zawartość overlay po załadowaniu (lub błędzie)
    if (heroVisualOverlay) {
      heroVisualOverlay.style.opacity = "1";
    }
  }

  if (slides.length === 0) {
    // Pokaż placeholder gdy brak wyjazdów
    heroVisualEl.style.backgroundImage =
      "linear-gradient(to top, rgba(0,0,0,0.85), rgba(0,0,0,0.25)), url('assets/images/hero-empty.jpg')";
    heroTagEl.textContent = "Brak dostępnych wyjazdów";
    heroMatchEl.textContent = "Wkrótce pojawią się nowe terminy";
    if (heroDateEl) {
      (heroDateEl as HTMLElement).style.display = "none";
    }
    heroMetaEl.textContent =
      "Zapisz się do newslettera, aby otrzymać informację o nowych wyjazdach";
    (heroSpotsEl as HTMLElement).style.display = "none";
    (heroPriceEl as HTMLElement).style.display = "none";
    heroCtaEl.href = "#kontakt";
    heroCtaEl.textContent = "Zapisz się do newslettera";
    heroCtaEl.classList.remove("pill-closed");
    heroPrevEl.style.display = "none";
    heroNextEl.style.display = "none";
    heroDotsWrapEl.innerHTML = "";
    return;
  }

  let currentSlide = 0;

  function renderHeroSlide(index: number) {
    const slide = slides[index];
    currentSlide = index;

    heroVisualEl.style.backgroundImage =
      "linear-gradient(to top, rgba(0,0,0,0.85), rgba(0,0,0,0.25)), url('" + slide.image + "')";

    heroTagEl.textContent = slide.tag;
    heroMatchEl.textContent = slide.name;
    
    // Wyświetl datę jeśli jest dostępna
    if (heroDateEl) {
      if (slide.date) {
        heroDateEl.textContent = slide.date;
        (heroDateEl as HTMLElement).style.display = "block";
      } else {
        (heroDateEl as HTMLElement).style.display = "none";
      }
    }
    
    heroMetaEl.textContent = slide.meta;
    heroSpotsEl.textContent = slide.spots;
    heroSpotsEl.className = slide.spotsClass; // Ustaw klasę CSS (pill lub pill pill-closed)
    (heroSpotsEl as HTMLElement).style.display = "flex"; // Upewnij się, że element jest widoczny
    heroPriceEl.textContent = slide.price;
    (heroPriceEl as HTMLElement).style.display = "flex"; // Upewnij się, że element jest widoczny
    
    // Ustaw tekst i href dla CTA
    heroCtaEl.textContent = slide.ctaText;
    heroCtaEl.href = slide.ctaHref;
    if (slide.isClosed) {
      // Gdy brak miejsc, link prowadzi do szczegółów, ale bez klasy pill-closed
      heroCtaEl.style.pointerEvents = "auto";
      heroCtaEl.style.cursor = "pointer";
      heroCtaEl.classList.remove("pill-closed");
    } else {
      heroCtaEl.style.pointerEvents = "auto";
      heroCtaEl.style.cursor = "pointer";
      heroCtaEl.classList.remove("pill-closed");
    }
    (heroCtaEl as HTMLElement).style.display = "inline-flex";

    // Store current slide href for click handler
    heroVisualEl.setAttribute("data-trip-href", slide.ctaHref);

    const dots = heroDotsWrapEl.querySelectorAll<HTMLButtonElement>(".hero-dot");
    dots.forEach((dot, i) => {
      dot.classList.toggle("active", i === index);
    });
  }

  function createHeroDots() {
    heroDotsWrapEl.innerHTML = "";
    slides.forEach((_slide, index) => {
      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = "hero-dot" + (index === 0 ? " active" : "");
      dot.addEventListener("click", () => renderHeroSlide(index));
      heroDotsWrapEl.appendChild(dot);
    });
  }

  createHeroDots();
  renderHeroSlide(0);

  // Make hero overlay clickable (excluding interactive elements)
  if (heroVisualOverlay) {
    heroVisualOverlay.style.pointerEvents = "auto";
    heroVisualOverlay.style.cursor = "pointer";
    heroVisualOverlay.addEventListener("click", (e) => {
      // Don't navigate if clicking on interactive elements
      const target = e.target as HTMLElement;
      if (
        target.closest(".hero-slider-controls") ||
        target.closest(".hero-arrow") ||
        target.closest(".hero-dot") ||
        target.closest(".pill-cta") ||
        target === heroCtaEl ||
        target === heroPrevEl ||
        target === heroNextEl ||
        heroDotsWrapEl.contains(target)
      ) {
        return;
      }

      // Navigate to trip details
      const href = heroVisualEl.getAttribute("data-trip-href");
      if (href) {
        window.location.href = href;
      }
    });
  }

  heroPrevEl.addEventListener("click", (e) => {
    e.stopPropagation();
    const nextIndex = (currentSlide - 1 + slides.length) % slides.length;
    renderHeroSlide(nextIndex);
  });

  heroNextEl.addEventListener("click", (e) => {
    e.stopPropagation();
    const nextIndex = (currentSlide + 1) % slides.length;
    renderHeroSlide(nextIndex);
  });

  // Stop propagation for dots
  heroDotsWrapEl.addEventListener("click", (e) => {
    e.stopPropagation();
  });

  // Stop propagation for CTA button
  heroCtaEl.addEventListener("click", (e) => {
    e.stopPropagation();
  });
}
