/**
 * System walidacji formularzy
 */

export type ValidationRule = {
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
  custom?: (value: string) => string | null; // zwraca błąd lub null
  message?: string; // niestandardowy komunikat błędu
};

export type ValidationRules = Record<string, ValidationRule>;

export interface ValidationResult {
  isValid: boolean;
  errors: Record<string, string>;
}

/**
 * Waliduje pojedyncze pole
 */
function validateField(value: string, rule: ValidationRule): string | null {
  if (rule.required && (!value || value.trim().length === 0)) {
    return rule.message || "To pole jest wymagane";
  }

  if (!value || value.trim().length === 0) {
    return null; // Puste pole jest OK jeśli nie jest required
  }

  if (rule.minLength && value.length < rule.minLength) {
    return rule.message || `Minimalna długość to ${rule.minLength} znaków`;
  }

  if (rule.maxLength && value.length > rule.maxLength) {
    return rule.message || `Maksymalna długość to ${rule.maxLength} znaków`;
  }

  if (rule.pattern && !rule.pattern.test(value)) {
    return rule.message || "Nieprawidłowy format";
  }

  if (rule.custom) {
    return rule.custom(value);
  }

  return null;
}

/**
 * Waliduje formularz
 */
export function validateForm(form: HTMLFormElement | HTMLElement, rules: ValidationRules): ValidationResult {
  const errors: Record<string, string> = {};

  for (const [fieldName, rule] of Object.entries(rules)) {
    const field = form.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
      `[name="${fieldName}"], #${fieldName}`
    );

    if (!field) {
      // Jeśli pole nie istnieje, pomiń (może być opcjonalne)
      continue;
    }

    const value = field.value.trim();
    const error = validateField(value, rule);

    if (error) {
      errors[fieldName] = error;
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
}

/**
 * Wyświetla błędy walidacji przy polach
 */
export function showFieldErrors(form: HTMLFormElement | HTMLElement, errors: Record<string, string>) {
  // Usuń poprzednie błędy
  clearFieldErrors(form);

  for (const [fieldName, errorMessage] of Object.entries(errors)) {
    const field = form.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
      `[name="${fieldName}"], #${fieldName}`
    );

    if (!field) continue;

    // Dodaj klasę błędu do pola
    field.classList.add("field-error");
    field.setAttribute("aria-invalid", "true");
    field.setAttribute("aria-describedby", `error-${fieldName}`);

    // Znajdź field-group lub form-group (rodzic)
    const fieldGroup = field.closest(".field-group") || field.closest(".form-group") || field.closest("label");
    if (fieldGroup) {
      // Sprawdź czy komunikat błędu już istnieje
      let errorEl = fieldGroup.querySelector(`#error-${fieldName}`) as HTMLElement;
      if (!errorEl) {
        // Utwórz element błędu
        errorEl = document.createElement("div");
        errorEl.id = `error-${fieldName}`;
        errorEl.className = "field-error-message";
        errorEl.setAttribute("role", "alert");
        // Dla ukrytego pola extendedDescription, dodaj błąd po Quill editorze, nie po ukrytym inputie
        if (fieldName === "extendedDescription" && field.type === "hidden") {
          const editorContainer = fieldGroup.querySelector("#trip-extended-description-editor");
          if (editorContainer && editorContainer.parentNode) {
            editorContainer.parentNode.insertBefore(errorEl, editorContainer.nextSibling);
          } else {
            fieldGroup.appendChild(errorEl);
          }
        } else if (fieldName === "hotelClass" && field.type === "hidden") {
          // Dla ukrytego pola hotelClass, dodaj błąd po kontenerze gwiazdek
          const starsContainer = fieldGroup.querySelector("#hotel-class-stars");
          if (starsContainer && starsContainer.parentNode) {
            starsContainer.parentNode.insertBefore(errorEl, starsContainer.nextSibling);
          } else {
            fieldGroup.appendChild(errorEl);
          }
          // Dodaj klasę błędu do kontenera gwiazdek
          if (starsContainer) {
            starsContainer.classList.add("field-error");
          }
        } else {
          // Dodaj po polu (lub na końcu field-group)
          fieldGroup.appendChild(errorEl);
        }
      }
      errorEl.textContent = errorMessage;
    }
  }
}

/**
 * Czyści wszystkie błędy walidacji
 */
export function clearFieldErrors(form: HTMLFormElement | HTMLElement) {
  // Usuń klasy błędów z pól
  const errorFields = form.querySelectorAll(".field-error");
  errorFields.forEach((field) => {
    field.classList.remove("field-error");
    field.removeAttribute("aria-invalid");
    field.removeAttribute("aria-describedby");
    // Wyczyść customValidity dla ukrytych pól (np. extendedDescription)
    if (field instanceof HTMLInputElement && field.type === "hidden") {
      field.setCustomValidity("");
    }
  });

  // Usuń komunikaty błędów
  const errorMessages = form.querySelectorAll(".field-error-message");
  errorMessages.forEach((msg) => msg.remove());
  
  // Usuń klasę błędu z kontenera gwiazdek klasy hotelu
  const hotelStarsContainer = form.querySelector("#hotel-class-stars");
  if (hotelStarsContainer) {
    hotelStarsContainer.classList.remove("field-error");
  }
}

/**
 * Waliduje email
 */
export function validateEmail(email: string): string | null {
  if (!email || email.trim().length === 0) {
    return "Adres e-mail jest wymagany";
  }

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(email)) {
    return "Nieprawidłowy format adresu e-mail";
  }

  return null;
}

/**
 * Waliduje numer telefonu (polski format)
 */
export function validatePhone(phone: string): string | null {
  if (!phone || phone.trim().length === 0) {
    return "Numer telefonu jest wymagany";
  }

  // Akceptuj różne formaty: +48 500 000 000, 500-000-000, 500000000, etc.
  const phonePattern = /^[\+]?[0-9\s\-\(\)]{9,}$/;
  if (!phonePattern.test(phone)) {
    return "Nieprawidłowy format numeru telefonu";
  }

  // Sprawdź czy ma co najmniej 9 cyfr
  const digitsOnly = phone.replace(/\D/g, "");
  if (digitsOnly.length < 9) {
    return "Numer telefonu musi zawierać co najmniej 9 cyfr";
  }

  return null;
}

/**
 * Waliduje imię i nazwisko
 */
export function validateName(name: string): string | null {
  if (!name || name.trim().length === 0) {
    return "Imię i nazwisko jest wymagane";
  }

  if (name.trim().length < 2) {
    return "Imię i nazwisko musi zawierać co najmniej 2 znaki";
  }

  // Sprawdź czy zawiera co najmniej jedną spację (imię i nazwisko)
  if (!name.trim().includes(" ")) {
    return "Podaj imię i nazwisko";
  }

  return null;
}

/**
 * Waliduje datę urodzenia
 */
export function validateBirthDate(date: string): string | null {
  if (!date || date.trim().length === 0) {
    return null; // Data urodzenia jest opcjonalna
  }

  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!datePattern.test(date)) {
    return "Nieprawidłowy format daty (YYYY-MM-DD)";
  }

  const birthDate = new Date(date);
  const today = new Date();
  const minDate = new Date();
  minDate.setFullYear(today.getFullYear() - 120); // Max 120 lat

  if (isNaN(birthDate.getTime())) {
    return "Nieprawidłowa data";
  }

  if (birthDate > today) {
    return "Data urodzenia nie może być w przyszłości";
  }

  if (birthDate < minDate) {
    return "Data urodzenia jest nieprawidłowa";
  }

  return null;
}

