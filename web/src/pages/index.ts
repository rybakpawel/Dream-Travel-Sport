import { tripsApi, contentApi } from "../api/client.js";
import { initHeroSlider } from "../features/hero-slider";
import { initNewsletter } from "../features/newsletter";
import { showSectionLoading, hideSectionLoading } from "../utils/loading.js";

type TripFromApi = {
  id: string;
  slug: string;
  name: string;
  tag: string;
  details: string;
  priceCents: number | null; // Najtańsza cena z miejsc wylotu lub null (fallback do starej ceny)
  spotsLabel: string | null;
  useAutoSpotsLabel: boolean;
  capacity: number | null;
  seatsLeft: number | null;
  availability: string;
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

async function renderTripsList() {
  const grid = document.querySelector<HTMLElement>("#oferta .grid");
  const subtitle = document.querySelector<HTMLElement>("#oferta-subtitle");
  const ofertaSection = document.getElementById("oferta");
  const ofertaTitle = ofertaSection?.querySelector("h2");
  if (!grid) return;

  // Pokaż loading state i ukryj tytuł oraz opis
  if (ofertaSection) {
    showSectionLoading(ofertaSection, "Ładowanie wyjazdów...");
    // Ukryj tytuł i opis podczas ładowania
    if (ofertaTitle) {
      ofertaTitle.style.display = "none";
    }
    if (subtitle) {
      subtitle.style.display = "none";
    }
  }

  try {
    const response = await tripsApi.getAll();
    const trips = (response.data || response) as TripFromApi[];

    // Ukryj loading state
    if (ofertaSection) {
      hideSectionLoading(ofertaSection);
    }

    // Wyczyść istniejące karty
    grid.innerHTML = "";

    if (trips.length === 0) {
      // Pokaż tytuł i ukryj subtitle gdy brak wyjazdów
      if (ofertaTitle) {
        ofertaTitle.style.display = "";
      }
      if (subtitle) {
        subtitle.style.display = "none";
      }
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
        <a href="#kontakt" class="btn-primary" style="display: inline-block;">Zapisz się do newslettera</a>
      `;
      grid.appendChild(emptyState);
      return;
    }

    // Pokaż tytuł i subtitle gdy są wyjazdy
    if (ofertaTitle) {
      ofertaTitle.style.display = "";
    }
    if (subtitle) {
      subtitle.style.display = "";
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
        // Jeśli liczba miejsc jest 0, dodaj czerwoną klasę
        spotsClass = trip.seatsLeft === 0 ? "pill-small pill-closed" : "pill-small";
      } else if (isWaitlist) {
        spots = "LISTA OCZEKUJĄCYCH";
        spotsClass = "pill-small pill-waitlist";
      } else if (trip.useAutoSpotsLabel && trip.capacity !== null && trip.seatsLeft !== null) {
        spots = `${trip.seatsLeft}/${trip.capacity} miejsc`;
        // Jeśli liczba miejsc jest 0, dodaj czerwoną klasę
        spotsClass = trip.seatsLeft === 0 ? "pill-small pill-closed" : "pill-small";
      } else {
        spots = trip.spotsLabel || "Sprawdź dostępność";
      }

      const tripDate = formatTripDate(trip.startsAt, trip.endsAt);

      article.innerHTML = `
        <a href="trip-details.html?slug=${trip.slug}" class="card-link">
          <figure class="card-image">
            <img src="${imagePath}" alt="${trip.name}">
            <div class="card-tag">${trip.tag}</div>
          </figure>
          <h3>${trip.name}</h3>
          ${tripDate ? `<div class="card-date">${tripDate}</div>` : ""}
          <p>${trip.details}</p>
          <div class="price-row">
            <span class="price">${formatPriceFromCents(trip.priceCents)}</span>
            <span class="${spotsClass}">${spots}</span>
          </div>
        </a>
      `;

      grid.appendChild(article);
    });
  } catch (err) {
    console.error("Failed to load trips from API:", err);
    // Ukryj loading state
    if (ofertaSection) {
      hideSectionLoading(ofertaSection);
    }
    // Pokaż tytuł i ukryj subtitle przy błędzie
    if (ofertaTitle) {
      ofertaTitle.style.display = "";
    }
    if (subtitle) {
      subtitle.style.display = "none";
    }
    // Pokaż komunikat błędu
    grid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1; text-align: center; padding: 60px 20px; color: var(--dt-muted);">
        <h3 style="color: var(--dt-light); margin-bottom: 16px; font-size: 24px;">Nie udało się załadować wyjazdów</h3>
        <p style="margin-bottom: 24px; max-width: 500px; margin-left: auto; margin-right: auto;">
          Wystąpił problem z połączeniem. Spróbuj odświeżyć stronę lub skontaktuj się z nami.
        </p>
        <a href="#kontakt" class="btn-primary" style="display: inline-block;">Skontaktuj się z nami</a>
      </div>
    `;
  }
}

async function loadContent() {
  try {
    const response = await contentApi.getAll("HOME");
    // apiRequest returns data.data ?? data
    // Backend returns { data: [...] }, so apiRequest returns the array directly
    const contents = Array.isArray(response) ? response : (response as any)?.data || [];

    // Create a map of section -> data for quick lookup
    const contentMap = new Map<string, any>();
    contents.forEach((item: any) => {
      // Backend returns { section, page, data }, so we need to access item.data
      if (item.data) {
        contentMap.set(item.section, item.data);
      }
    });

    // Update Hero section
    const heroData = contentMap.get("HOME_HERO");
    const badgesContainer = document.querySelector(
      ".hero-badges[data-content-section='HOME_HERO']"
    ) as HTMLElement;

    if (heroData) {
      // Badges - only update if we have badges in data
      if (
        badgesContainer &&
        heroData.badges &&
        Array.isArray(heroData.badges) &&
        heroData.badges.length > 0
      ) {
        badgesContainer.innerHTML = heroData.badges
          .map((badge: string) => `<div class="badge">${badge}</div>`)
          .join("");
      }

      // Title
      const titleEl = document.querySelector(
        "[data-content-section='HOME_HERO'][data-content-field='title']"
      );
      if (titleEl && heroData.title) {
        // Replace newlines with <br />
        const titleHtml = heroData.title.replace(/\n/g, "<br />");
        titleEl.innerHTML = titleHtml.replace(
          /Dream Travel Sport/g,
          "<span>Dream&nbsp;Travel&nbsp;Sport</span>"
        );
      }

      // Description
      const descEl = document.querySelector(
        "[data-content-section='HOME_HERO'][data-content-field='description']"
      );
      if (descEl && heroData.description) {
        descEl.textContent = heroData.description;
        // Add link to Dream Points if not present
        if (!descEl.querySelector("a")) {
          const link = document.createElement("a");
          link.className = "u-link-gold-underline";
          link.href = "dream-points.html";
          link.textContent = "Sprawdź jak działają.";
          descEl.appendChild(document.createTextNode(" "));
          descEl.appendChild(link);
        }
      }

      // Note
      const noteEl = document.querySelector(
        "[data-content-section='HOME_HERO'][data-content-field='note']"
      );
      if (noteEl && heroData.note) {
        noteEl.textContent = heroData.note;
      }

      // CTA
      const ctaTextEl = document.querySelector(
        "[data-content-section='HOME_HERO'][data-content-field='ctaText']"
      );
      if (ctaTextEl && heroData.ctaText) {
        ctaTextEl.textContent = heroData.ctaText;
      }

      const ctaSubtextEl = document.querySelector(
        "[data-content-section='HOME_HERO'][data-content-field='ctaSubtext']"
      );
      if (ctaSubtextEl && heroData.ctaSubtext) {
        ctaSubtextEl.textContent = heroData.ctaSubtext;
      }
    }

    // Update Upcoming Trips section
    const upcomingData = contentMap.get("HOME_UPCOMING_TRIPS");
    if (upcomingData) {
      const titleEl = document.querySelector(
        "[data-content-section='HOME_UPCOMING_TRIPS'][data-content-field='title']"
      );
      if (titleEl && upcomingData.title) {
        titleEl.textContent = upcomingData.title;
      }

      const subtitleEl = document.querySelector(
        "[data-content-section='HOME_UPCOMING_TRIPS'][data-content-field='subtitle']"
      );
      if (subtitleEl && upcomingData.subtitle) {
        subtitleEl.textContent = upcomingData.subtitle;
      }
    }

    // Update How It Works section
    const howItWorksData = contentMap.get("HOME_HOW_IT_WORKS");
    if (howItWorksData) {
      const titleEl = document.querySelector(
        "[data-content-section='HOME_HOW_IT_WORKS'][data-content-field='title']"
      );
      if (titleEl && howItWorksData.title) {
        titleEl.textContent = howItWorksData.title;
      }

      const subtitleEl = document.querySelector(
        "[data-content-section='HOME_HOW_IT_WORKS'][data-content-field='subtitle']"
      );
      if (subtitleEl && howItWorksData.subtitle) {
        subtitleEl.textContent = howItWorksData.subtitle;
      }

      // Update steps
      if (howItWorksData.steps && Array.isArray(howItWorksData.steps)) {
        const stepsContainer = document.querySelector("#jak-dzialamy .card.steps");
        if (stepsContainer) {
          stepsContainer.innerHTML = howItWorksData.steps
            .map(
              (step: any, index: number) => `
              <div class="step">
                <div class="step-badge">${index + 1}</div>
                <div class="step-content">
                  <h3>${step.title || ""}</h3>
                  <p>${step.description || ""}</p>
                </div>
              </div>
            `
            )
            .join("");
        }
      }
    }

    // Update Why Us section
    const whyUsData = contentMap.get("HOME_WHY_US");
    if (whyUsData) {
      const titleEl = document.querySelector(
        "[data-content-section='HOME_WHY_US'][data-content-field='title']"
      );
      if (titleEl && whyUsData.title) {
        titleEl.textContent = whyUsData.title;
      }

      const subtitleEl = document.querySelector(
        "[data-content-section='HOME_WHY_US'][data-content-field='subtitle']"
      );
      if (subtitleEl && whyUsData.subtitle) {
        subtitleEl.textContent = whyUsData.subtitle;
      }

      // Update cards
      if (whyUsData.cards && Array.isArray(whyUsData.cards)) {
        const cardsContainer = document.querySelector("#dlaczego .grid");
        if (cardsContainer) {
          cardsContainer.innerHTML = whyUsData.cards
            .map(
              (card: any) => `
              <div class="card">
                <h3>${card.title || ""}</h3>
                <p>${card.description || ""}</p>
              </div>
            `
            )
            .join("");
        }
      }
    }

    // Update Newsletter section
    const newsletterData = contentMap.get("HOME_NEWSLETTER");
    if (newsletterData) {
      const titleEl = document.querySelector("#kontakt h2");
      if (titleEl && newsletterData.title) {
        titleEl.textContent = newsletterData.title;
      }

      const subtitleEl = document.querySelector("#kontakt .section-subtitle");
      if (subtitleEl && newsletterData.subtitle) {
        subtitleEl.textContent = newsletterData.subtitle;
      }
    }
  } catch (err) {
    console.error("Failed to load content:", err);
    // Continue with default content if API fails
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  // Ukryj tytuł i opis sekcji "oferta" od razu, zanim zacznie się ładowanie
  const ofertaSection = document.getElementById("oferta");
  const ofertaTitle = ofertaSection?.querySelector("h2");
  const ofertaSubtitle = document.getElementById("oferta-subtitle");
  if (ofertaTitle) {
    ofertaTitle.style.display = "none";
  }
  if (ofertaSubtitle) {
    ofertaSubtitle.style.display = "none";
  }

  // Ukryj zawartość hero od razu, zanim zacznie się ładowanie
  const heroVisual = document.getElementById("hero-visual");
  const heroVisualOverlay = heroVisual?.querySelector(".hero-visual-overlay") as HTMLElement | null;
  if (heroVisualOverlay) {
    heroVisualOverlay.style.opacity = "0";
  }

  await loadContent();
  await initHeroSlider();
  await renderTripsList();
  initNewsletter();
});
