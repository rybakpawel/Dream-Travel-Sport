export type CartItem = {
  id: string; // tripId (slug wyjazdu)
  qty: number;
  departurePointId?: string; // ID wybranego miejsca wylotu (opcjonalne dla kompatybilności wstecznej)
  priceCents?: number; // Cena z wybranego miejsca wylotu (opcjonalne dla kompatybilności wstecznej)
};

export type Cart = CartItem[];


