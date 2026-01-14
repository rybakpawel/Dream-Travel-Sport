/**
 * System powiadomień (toast notifications)
 */

export type NotificationType = "success" | "error" | "warning" | "info";

export interface NotificationOptions {
  type?: NotificationType;
  duration?: number; // w milisekundach, 0 = nie znikają automatycznie
  closable?: boolean;
}

class NotificationManager {
  private container: HTMLElement | null = null;

  private initContainer() {
    if (this.container) return;

    this.container = document.createElement("div");
    this.container.id = "notifications-container";
    this.container.className = "notifications-container";
    document.body.appendChild(this.container);
  }

  show(message: string, options: NotificationOptions = {}) {
    this.initContainer();
    if (!this.container) return;

    const {
      type = "info",
      duration = 5000,
      closable = true
    } = options;

    const notification = document.createElement("div");
    notification.className = `notification notification--${type}`;
    notification.setAttribute("role", "alert");
    notification.setAttribute("aria-live", "polite");

    // Ikona w zależności od typu
    const iconMap: Record<NotificationType, string> = {
      success: "✓",
      error: "✕",
      warning: "⚠",
      info: "ℹ"
    };

    notification.innerHTML = `
      <div class="notification__icon">${iconMap[type]}</div>
      <div class="notification__message">${this.escapeHtml(message)}</div>
      ${closable ? '<button class="notification__close" aria-label="Zamknij">&times;</button>' : ""}
    `;

    // Przycisk zamknięcia
    if (closable) {
      const closeBtn = notification.querySelector(".notification__close");
      closeBtn?.addEventListener("click", () => {
        this.remove(notification);
      });
    }

    this.container.appendChild(notification);

    // Animacja pojawienia się
    requestAnimationFrame(() => {
      notification.classList.add("notification--show");
    });

    // Automatyczne usunięcie po czasie
    if (duration > 0) {
      setTimeout(() => {
        this.remove(notification);
      }, duration);
    }

    return notification;
  }

  private remove(notification: HTMLElement) {
    notification.classList.remove("notification--show");
    notification.classList.add("notification--hide");

    setTimeout(() => {
      notification.remove();
    }, 300); // Czas na animację znikania
  }

  private escapeHtml(text: string): string {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  success(message: string, options?: Omit<NotificationOptions, "type">) {
    return this.show(message, { ...options, type: "success" });
  }

  error(message: string, options?: Omit<NotificationOptions, "type">) {
    return this.show(message, { ...options, type: "error", duration: 7000 });
  }

  warning(message: string, options?: Omit<NotificationOptions, "type">) {
    return this.show(message, { ...options, type: "warning", duration: 6000 });
  }

  info(message: string, options?: Omit<NotificationOptions, "type">) {
    return this.show(message, { ...options, type: "info" });
  }
}

export const notifications = new NotificationManager();

