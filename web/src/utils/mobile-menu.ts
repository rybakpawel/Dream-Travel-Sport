/**
 * Mobile menu toggle functionality
 */
export function initMobileMenu() {
  const toggleButton = document.querySelector<HTMLButtonElement>(".mobile-menu-toggle");
  const mobileMenu = document.querySelector<HTMLElement>(".mobile-menu");
  const overlay = document.querySelector<HTMLElement>(".mobile-menu-overlay");
  const menuLinks = document.querySelectorAll<HTMLAnchorElement>(".mobile-menu nav a");

  if (!toggleButton || !mobileMenu || !overlay) {
    return;
  }

  function openMenu() {
    toggleButton?.classList.add("active");
    mobileMenu?.classList.add("active");
    overlay?.classList.add("active");
    document.body.style.overflow = "hidden";
  }

  function closeMenu() {
    toggleButton?.classList.remove("active");
    mobileMenu?.classList.remove("active");
    overlay?.classList.remove("active");
    document.body.style.overflow = "";
  }

  function toggleMenu() {
    if (mobileMenu?.classList.contains("active")) {
      closeMenu();
    } else {
      openMenu();
    }
  }

  // Toggle button click
  toggleButton.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleMenu();
  });

  // Overlay click to close
  overlay.addEventListener("click", closeMenu);

  // Close menu when clicking on a link
  menuLinks.forEach((link) => {
    link.addEventListener("click", () => {
      closeMenu();
    });
  });

  // Close menu on escape key
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && mobileMenu?.classList.contains("active")) {
      closeMenu();
    }
  });

  // Close menu on window resize if it's larger than mobile breakpoint
  window.addEventListener("resize", () => {
    if (window.innerWidth > 840 && mobileMenu?.classList.contains("active")) {
      closeMenu();
    }
  });
}

// Automatyczna inicjalizacja przy załadowaniu strony
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initMobileMenu);
} else {
  initMobileMenu();
}

