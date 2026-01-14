import { newsletterApi } from "../../api/client.js";
import { clearFieldErrors, showFieldErrors, validateEmail, validateForm, type ValidationRules } from "../../utils/form-validation.js";
import { setButtonLoading, withButtonLoading } from "../../utils/loading.js";
import { notifications } from "../../utils/notifications.js";

export function initNewsletter() {
  const form = document.getElementById("newsletter-form") as HTMLFormElement | null;
  const successBox = document.getElementById("newsletter-success");
  const goTripsBtn = document.getElementById("newsletter-go-to-trips") as HTMLButtonElement | null;

  if (form && successBox) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      // Walidacja formularza
      clearFieldErrors(form);

      const formData = new FormData(form);
      const name = formData.get("name") as string;
      const email = formData.get("email") as string;

      const validationRules: ValidationRules = {
        email: {
          required: true,
          custom: validateEmail
        }
      };

      const validation = validateForm(form, validationRules);

      if (!validation.isValid) {
        showFieldErrors(form, validation.errors);
        const firstErrorField = form.querySelector(".field-error") as HTMLElement;
        if (firstErrorField) {
          firstErrorField.focus();
        }
        return;
      }

      const submitButton = form.querySelector<HTMLButtonElement>('button[type="submit"]') ||
        form.querySelector<HTMLButtonElement>("button") ||
        form.querySelector<HTMLElement>(".btn-primary");

      await withButtonLoading(
        submitButton || form,
        async () => {
          try {
            await newsletterApi.subscribe({
              email,
              name: name || undefined
            });

            form.reset();
            successBox.style.display = "flex";
            successBox.scrollIntoView({ behavior: "smooth", block: "center" });
            notifications.success("Zapisano do newslettera! Sprawdź swoją skrzynkę e-mail.");
          } catch (err) {
            console.error("Newsletter subscription failed:", err);
            notifications.error("Wystąpił błąd podczas zapisu do newslettera. Spróbuj ponownie.");
            throw err; // Rzuć błąd, aby withButtonLoading mógł go obsłużyć
          }
        },
        "Zapisywanie..."
      );
    });
  }

  if (goTripsBtn) {
    goTripsBtn.addEventListener("click", () => {
      const oferta = document.getElementById("oferta");
      if (oferta) {
        oferta.scrollIntoView({ behavior: "smooth" });
      } else {
        window.location.href = "#oferta";
      }
    });
  }
}


