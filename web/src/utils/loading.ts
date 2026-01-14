/**
 * System zarządzania stanami ładowania
 */

/**
 * Pokazuje spinner ładowania w elemencie
 */
export function showLoading(element: HTMLElement, text: string = "Ładowanie...") {
  // Sprawdź czy już jest loading
  if (element.querySelector(".loading-spinner")) {
    return;
  }

  const originalContent = element.innerHTML;
  element.setAttribute("data-original-content", originalContent);
  element.setAttribute("data-loading", "true");

  const spinner = document.createElement("div");
  spinner.className = "loading-spinner";
  spinner.innerHTML = `
    <div class="spinner"></div>
    <span class="loading-text">${text}</span>
  `;

  element.innerHTML = "";
  element.appendChild(spinner);
  element.classList.add("is-loading");
}

/**
 * Ukrywa spinner ładowania i przywraca oryginalną zawartość
 */
export function hideLoading(element: HTMLElement) {
  // Usuń spinner jeśli istnieje
  const spinner = element.querySelector(".loading-spinner");
  if (spinner) {
    spinner.remove();
  }

  // Usuń overlay jeśli istnieje
  const overlay = element.querySelector(".loading-overlay");
  if (overlay) {
    overlay.remove();
  }

  // Przywróć oryginalną zawartość jeśli była zapisana
  const originalContent = element.getAttribute("data-original-content");
  if (originalContent !== null) {
    element.innerHTML = originalContent;
    element.removeAttribute("data-original-content");
  } else {
    // Jeśli nie było oryginalnej zawartości, wyczyść element
    // (zostanie wypełniony przez funkcję renderującą)
    element.innerHTML = "";
  }

  element.removeAttribute("data-loading");
  element.classList.remove("is-loading");
}

/**
 * Sprawdza czy element jest w stanie ładowania
 */
export function isLoading(element: HTMLElement): boolean {
  return element.getAttribute("data-loading") === "true";
}

/**
 * Blokuje przycisk i pokazuje loading
 */
export function setButtonLoading(
  button: HTMLButtonElement | HTMLElement,
  loading: boolean,
  loadingText: string = "Przetwarzanie..."
) {
  if (loading) {
    if (button instanceof HTMLButtonElement) {
      button.disabled = true;
    }
    button.setAttribute("aria-busy", "true");
    showLoading(button, loadingText);
  } else {
    if (button instanceof HTMLButtonElement) {
      button.disabled = false;
    }
    button.removeAttribute("aria-busy");
    hideLoading(button);
  }
}

/**
 * Pokazuje overlay loading na całej sekcji
 */
export function showSectionLoading(container: HTMLElement, text: string = "Ładowanie...") {
  // Sprawdź czy już jest loading overlay
  if (container.querySelector(".loading-overlay")) {
    return;
  }

  const overlay = document.createElement("div");
  overlay.className = "loading-overlay";
  overlay.innerHTML = `
    <div class="loading-spinner">
      <div class="spinner"></div>
      <span class="loading-text">${text}</span>
    </div>
  `;

  container.style.position = "relative";
  container.appendChild(overlay);
}

/**
 * Ukrywa overlay loading
 */
export function hideSectionLoading(container: HTMLElement) {
  const overlay = container.querySelector(".loading-overlay");
  if (overlay) {
    overlay.remove();
  }
}

/**
 * Wrapper dla async funkcji z automatycznym loading state
 */
export async function withLoading<T>(
  element: HTMLElement,
  asyncFn: () => Promise<T>,
  loadingText?: string
): Promise<T> {
  showLoading(element, loadingText);
  try {
    const result = await asyncFn();
    return result;
  } finally {
    hideLoading(element);
  }
}

/**
 * Wrapper dla async funkcji z loading state na przycisku
 */
export async function withButtonLoading<T>(
  button: HTMLButtonElement | HTMLElement,
  asyncFn: () => Promise<T>,
  loadingText?: string
): Promise<T> {
  setButtonLoading(button, true, loadingText);
  try {
    const result = await asyncFn();
    return result;
  } finally {
    setButtonLoading(button, false);
  }
}
