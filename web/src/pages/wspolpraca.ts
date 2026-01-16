import { contentApi, contactApi } from "../api/client.js";
import { notifications } from "../utils/notifications.js";

// Slider dla galerii zdjęć na stronie współpracy
export function initGallerySlider(images: string[] = []) {
  const gallerySection = document.querySelector(".gallery-section") as HTMLElement | null;
  const slider = document.getElementById("gallery-slider") as HTMLElement | null;
  const prevBtn = document.getElementById("gallery-prev") as HTMLButtonElement | null;
  const nextBtn = document.getElementById("gallery-next") as HTMLButtonElement | null;
  const dotsWrap = document.getElementById("gallery-dots") as HTMLElement | null;

  // Jeśli brak zdjęć, ukryj sekcję
  if (!images || images.length === 0) {
    if (gallerySection) {
      gallerySection.style.display = "none";
    }
    return;
  }

  // Pokaż sekcję jeśli była ukryta
  if (gallerySection) {
    gallerySection.style.display = "";
  }

  if (!slider || !prevBtn || !nextBtn || !dotsWrap) {
    return;
  }

  let currentSlide = 0;

  function renderSlide(index: number) {
    currentSlide = index;
    const imageUrl = images[index] || images[0];
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
}

// Obsługa formularza kontaktowego
export function initContactForm() {
  const form = document.getElementById("contact-form") as HTMLFormElement | null;
  const successMessage = document.getElementById("contact-success") as HTMLElement | null;
  const submitButton = form?.querySelector('button[type="submit"]') as HTMLButtonElement | null;

  if (!form || !successMessage) {
    return;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    if (!submitButton) return;

    // Wyłącz przycisk podczas wysyłania
    submitButton.disabled = true;
    const originalText = submitButton.textContent;
    submitButton.textContent = "Wysyłanie...";

    try {
      const formData = new FormData(form);
      const data = {
        name: formData.get("name") as string,
        email: formData.get("email") as string,
        company: (formData.get("company") as string) || undefined,
        phone: (formData.get("phone") as string) || undefined,
        message: formData.get("message") as string
      };

      await contactApi.submit(data);

      // Pokaż komunikat sukcesu
      form.style.display = "none";
      successMessage.classList.add("is-visible");
      successMessage.innerHTML = `
        <strong>Dziękujemy za wiadomość!</strong><br>
        Otrzymaliśmy Twoją wiadomość i skontaktujemy się z Tobą w ciągu 24 godzin.
      `;

      // Reset formularza
      form.reset();
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Nie udało się wysłać wiadomości. Spróbuj ponownie później.";
      notifications.error(errorMessage);
    } finally {
      // Przywróć przycisk
      submitButton.disabled = false;
      submitButton.textContent = originalText || "Wyślij wiadomość";
    }
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
    const introSection = document.querySelector(
      "[data-content-section='COOP_INTRO']"
    ) as HTMLElement | null;
    
    if (introData && introSection) {
      const titleEl = introSection.querySelector(
        "[data-content-field='title']"
      );
      if (titleEl && introData.title) {
        titleEl.textContent = introData.title;
      }

      const paragraphsEl = introSection.querySelector(
        "[data-content-field='paragraphs']"
      );
      if (paragraphsEl && introData.paragraphs && Array.isArray(introData.paragraphs)) {
        paragraphsEl.innerHTML = introData.paragraphs
          .map((para: string) => `<p>${para}</p>`)
          .join("");
      }
    }

    // Update Gallery section
    const galleryData = contentMap.get("COOP_GALLERY");
    const gallerySection = document.querySelector(
      "[data-content-section='COOP_GALLERY']"
    ) as HTMLElement | null;
    
    if (galleryData && gallerySection) {
      const titleEl = gallerySection.querySelector(
        "[data-content-field='title']"
      );
      if (titleEl && galleryData.title) {
        titleEl.textContent = galleryData.title;
      }

      const subtitleEl = gallerySection.querySelector(
        "[data-content-field='subtitle']"
      );
      if (subtitleEl && galleryData.subtitle) {
        subtitleEl.textContent = galleryData.subtitle;
      }

      // Initialize gallery slider with images from API
      const images = Array.isArray(galleryData.images) ? galleryData.images : [];
      initGallerySlider(images);
    } else {
      // If no gallery data, hide the section
      initGallerySlider([]);
    }

    // Update Contact section
    const contactData = contentMap.get("COOP_CONTACT");
    const contactSection = document.querySelector(
      "[data-content-section='COOP_CONTACT']"
    ) as HTMLElement | null;
    
    if (contactData && contactSection) {
      const titleEl = contactSection.querySelector(
        "[data-content-field='title']"
      );
      if (titleEl && contactData.title) {
        titleEl.textContent = contactData.title;
      }

      const subtitleEl = contactSection.querySelector(
        "[data-content-field='subtitle']"
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

