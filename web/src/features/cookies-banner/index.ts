/**
 * Cookies banner - wyświetla belkę z informacją o cookies i przyciskiem akceptacji
 */

const COOKIES_CONSENT_KEY = "dt-cookies-consent";

function hasCookiesConsent(): boolean {
  return localStorage.getItem(COOKIES_CONSENT_KEY) === "accepted";
}

function setCookiesConsent(): void {
  localStorage.setItem(COOKIES_CONSENT_KEY, "accepted");
}

function initCookiesBanner() {
  // Sprawdź czy użytkownik już zaakceptował cookies
  if (hasCookiesConsent()) {
    return;
  }

  const banner = document.getElementById("cookies-banner");
  if (!banner) {
    return;
  }

  // Pokaż banner
  banner.style.display = "flex";

  // Obsługa przycisku "Akceptuję"
  const acceptButton = banner.querySelector<HTMLButtonElement>("#cookies-accept");
  if (acceptButton) {
    acceptButton.addEventListener("click", () => {
      setCookiesConsent();
      // Ukryj banner z animacją
      banner.style.opacity = "0";
      banner.style.transform = "translateY(100%)";
      setTimeout(() => {
        banner.style.display = "none";
      }, 300);
    });
  }
}

// Inicjalizuj po załadowaniu DOM
document.addEventListener("DOMContentLoaded", initCookiesBanner);

