import { contentApi } from "../api/client.js";

async function loadContent() {
  try {
    const response = await contentApi.getAll("DREAM_POINTS");
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
    const introData = contentMap.get("DP_INTRO");
    if (introData) {
      const titleEl = document.querySelector(
        "[data-content-section='DP_INTRO'][data-content-field='title']"
      );
      if (titleEl && introData.title) {
        titleEl.textContent = introData.title;
      }

      const subtitleEl = document.querySelector(
        "[data-content-section='DP_INTRO'][data-content-field='subtitle']"
      );
      if (subtitleEl && introData.subtitle) {
        subtitleEl.innerHTML = introData.subtitle;
      }
    }

    // Update How Many section
    const howManyData = contentMap.get("DP_HOW_MANY");
    if (howManyData) {
      const titleEl = document.querySelector(
        "[data-content-section='DP_HOW_MANY'][data-content-field='title']"
      );
      if (titleEl && howManyData.title) {
        titleEl.textContent = howManyData.title;
      }

      const paragraphsEl = document.querySelector(
        "[data-content-section='DP_HOW_MANY'][data-content-field='paragraphs']"
      );
      if (paragraphsEl && howManyData.paragraphs && Array.isArray(howManyData.paragraphs)) {
        paragraphsEl.innerHTML = howManyData.paragraphs
          .map(
            (para: string) => `
          <p>${para}</p>
        `
          )
          .join("");
      }
    }

    // Update Vouchers section
    const vouchersData = contentMap.get("DP_VOUCHERS");
    if (vouchersData) {
      const titleEl = document.querySelector(
        "[data-content-section='DP_VOUCHERS'][data-content-field='title']"
      );
      if (titleEl && vouchersData.title) {
        titleEl.textContent = vouchersData.title;
      }

      const descEl = document.querySelector(
        "[data-content-section='DP_VOUCHERS'][data-content-field='description']"
      );
      if (descEl && vouchersData.description) {
        descEl.innerHTML = vouchersData.description;
      }

      const noteEl = document.querySelector(
        "[data-content-section='DP_VOUCHERS'][data-content-field='note']"
      );
      if (noteEl && vouchersData.note) {
        noteEl.textContent = vouchersData.note;
      }
    }

    // Update Why Account section
    const whyAccountData = contentMap.get("DP_WHY_ACCOUNT");
    if (whyAccountData) {
      const titleEl = document.querySelector(
        "[data-content-section='DP_WHY_ACCOUNT'][data-content-field='title']"
      );
      if (titleEl && whyAccountData.title) {
        titleEl.textContent = whyAccountData.title;
      }

      const itemsEl = document.querySelector(
        "[data-content-section='DP_WHY_ACCOUNT'][data-content-field='items']"
      );
      if (itemsEl && whyAccountData.items && Array.isArray(whyAccountData.items)) {
        itemsEl.innerHTML = whyAccountData.items
          .map((item: string) => {
            // Check if item contains "200 DP" to add highlight
            const highlighted = item.replace(
              /200 DP/g,
              '<span class="dp-highlight">200&nbsp;DP</span>'
            );
            return `<li>${highlighted}</li>`;
          })
          .join("");
      }

      const noteEl = document.querySelector(
        "[data-content-section='DP_WHY_ACCOUNT'][data-content-field='note']"
      );
      if (noteEl && whyAccountData.note) {
        noteEl.textContent = whyAccountData.note;
      }

      const footerEl = document.querySelector(
        "[data-content-section='DP_WHY_ACCOUNT'][data-content-field='footer']"
      );
      if (footerEl && whyAccountData.footer) {
        footerEl.textContent = whyAccountData.footer;
      }
    }
  } catch (err) {
    console.error("Failed to load content:", err);
    // Continue with default content if API fails
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  await loadContent();
});

