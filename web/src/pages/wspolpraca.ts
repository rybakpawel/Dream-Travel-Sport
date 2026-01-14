import { contentApi } from "../api/client.js";

// Slider dla galerii zdjęć na stronie współpracy
export function initGallerySlider() {
  const slider = document.getElementById("gallery-slider") as HTMLElement | null;
  const prevBtn = document.getElementById("gallery-prev") as HTMLButtonElement | null;
  const nextBtn = document.getElementById("gallery-next") as HTMLButtonElement | null;
  const dotsWrap = document.getElementById("gallery-dots") as HTMLElement | null;

  if (!slider || !prevBtn || !nextBtn || !dotsWrap) {
    return;
  }

  // Przykładowe zdjęcia - w przyszłości można pobierać z API
  const images = [
    "assets/images/cooperation-1.jpg",
    "assets/images/cooperation-2.jpg",
    "assets/images/cooperation-3.jpg",
    "assets/images/cooperation-4.jpg",
  ];

  // Fallback do placeholderów jeśli zdjęcia nie istnieją
  const placeholderImages = [
    "https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=1200&h=800&fit=crop",
    "https://images.unsplash.com/photo-1551632811-561732d1e306?w=1200&h=800&fit=crop",
    "https://images.unsplash.com/photo-1574629810360-7efbbe195018?w=1200&h=800&fit=crop",
    "https://images.unsplash.com/photo-1579952363873-27f3bade9f55?w=1200&h=800&fit=crop",
  ];

  let currentSlide = 0;

  function renderSlide(index: number) {
    currentSlide = index;
    const imageUrl = images[index] || placeholderImages[index] || placeholderImages[0];
    slider.style.backgroundImage = `url('${imageUrl}')`;

    // Aktualizuj kropki
    const dots = dotsWrap.querySelectorAll<HTMLButtonElement>(".gallery-dot");
    dots.forEach((dot, i) => {
      dot.classList.toggle("active", i === index);
    });
  }

  function createDots() {
    dotsWrap.innerHTML = "";
    images.forEach((_image, index) => {
      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = "gallery-dot" + (index === 0 ? " active" : "");
      dot.addEventListener("click", () => renderSlide(index));
      dotsWrap.appendChild(dot);
    });
  }

  createDots();
  renderSlide(0);

  prevBtn.addEventListener("click", () => {
    const nextIndex = (currentSlide - 1 + images.length) % images.length;
    renderSlide(nextIndex);
  });

  nextBtn.addEventListener("click", () => {
    const nextIndex = (currentSlide + 1) % images.length;
    renderSlide(nextIndex);
  });

  // Auto-play (opcjonalnie)
  // let autoPlayInterval: number | null = null;
  // function startAutoPlay() {
  //   autoPlayInterval = window.setInterval(() => {
  //     const nextIndex = (currentSlide + 1) % images.length;
  //     renderSlide(nextIndex);
  //   }, 5000);
  // }
  // function stopAutoPlay() {
  //   if (autoPlayInterval) {
  //     clearInterval(autoPlayInterval);
  //     autoPlayInterval = null;
  //   }
  // }
  // startAutoPlay();
  // slider.addEventListener("mouseenter", stopAutoPlay);
  // slider.addEventListener("mouseleave", startAutoPlay);
}

// Obsługa formularza kontaktowego (bez backendu - tylko UI)
export function initContactForm() {
  const form = document.getElementById("contact-form") as HTMLFormElement | null;
  const successMessage = document.getElementById("contact-success") as HTMLElement | null;

  if (!form || !successMessage) {
    return;
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();

    // Symulacja wysłania formularza
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());

    console.log("Formularz kontaktowy (symulacja):", data);

    // Pokaż komunikat sukcesu
    form.style.display = "none";
    successMessage.classList.add("is-visible");
    successMessage.innerHTML = `
      <strong>Dziękujemy za wiadomość!</strong><br>
      Wkrótce się z Tobą skontaktujemy.
    `;

    // Reset formularza po 5 sekundach (dla demonstracji)
    setTimeout(() => {
      form.reset();
      form.style.display = "flex";
      successMessage.classList.remove("is-visible");
    }, 5000);
  });
}

async function loadContent() {
  try {
    const response = await contentApi.getAll("COOPERATION");
    // apiRequest returns data.data ?? data, so response is already the array
    const contents = Array.isArray(response) ? response : (response as any)?.data || [];

    // Create a map of section -> data for quick lookup
    const contentMap = new Map<string, any>();
    contents.forEach((item: any) => {
      // Backend returns { section, page, data }, so we need to access item.data
      if (item.data) {
        contentMap.set(item.section, item.data);
      }
    });

    // Update Intro section
    const introData = contentMap.get("COOP_INTRO");
    if (introData) {
      const titleEl = document.querySelector(
        "[data-content-section='COOP_INTRO'][data-content-field='title']"
      );
      if (titleEl && introData.title) {
        titleEl.textContent = introData.title;
      }

      const paragraphsEl = document.querySelector(
        "[data-content-section='COOP_INTRO'][data-content-field='paragraphs']"
      );
      if (paragraphsEl && introData.paragraphs && Array.isArray(introData.paragraphs)) {
        paragraphsEl.innerHTML = introData.paragraphs
          .map((para: string) => `<p>${para}</p>`)
          .join("");
      }
    }

    // Update Gallery section
    const galleryData = contentMap.get("COOP_GALLERY");
    if (galleryData) {
      const titleEl = document.querySelector(
        "[data-content-section='COOP_GALLERY'][data-content-field='title']"
      );
      if (titleEl && galleryData.title) {
        titleEl.textContent = galleryData.title;
      }

      const subtitleEl = document.querySelector(
        "[data-content-section='COOP_GALLERY'][data-content-field='subtitle']"
      );
      if (subtitleEl && galleryData.subtitle) {
        subtitleEl.textContent = galleryData.subtitle;
      }
    }

    // Update Contact section
    const contactData = contentMap.get("COOP_CONTACT");
    if (contactData) {
      const titleEl = document.querySelector(
        "[data-content-section='COOP_CONTACT'][data-content-field='title']"
      );
      if (titleEl && contactData.title) {
        titleEl.textContent = contactData.title;
      }

      const subtitleEl = document.querySelector(
        "[data-content-section='COOP_CONTACT'][data-content-field='subtitle']"
      );
      if (subtitleEl && contactData.subtitle) {
        subtitleEl.textContent = contactData.subtitle;
      }
    }
  } catch (err) {
    console.error("Failed to load content:", err);
    // Continue with default content if API fails
  }
}

// Load content when DOM is ready
document.addEventListener("DOMContentLoaded", async () => {
  await loadContent();
});

