/**
 * Funkcja pomocnicza do renderowania gwiazdek klasy hotelu
 * @param rating - Klasa hotelu (1-5) lub null
 * @returns HTML string z gwiazdkami
 */
export function renderHotelStars(rating: number | null): string {
  if (!rating || rating < 1 || rating > 5) {
    return '<span class="hotel-stars" aria-label="Klasa hotelu nieokreślona"><span class="star-empty">—</span></span>';
  }

  const stars = Array.from({ length: 5 }, (_, i) => {
    const isActive = i < rating;
    return `<span class="star ${isActive ? "star-active" : "star-inactive"}" aria-hidden="true">★</span>`;
  }).join("");

  return `<span class="hotel-stars" aria-label="${rating} ${rating === 1 ? "gwiazdka" : rating < 5 ? "gwiazdki" : "gwiazdek"}">${stars}</span>`;
}

