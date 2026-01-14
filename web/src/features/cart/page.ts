import { addTrip, setItemQty, removeItem } from "./operations";
import { renderCart } from "./render";
import { loadCart, saveCart } from "./storage";
import { readQueryTrip, removeTripFromUrl } from "./url";

export async function initCartPage() {
  // 1) Add trip from query string (if present)
  // W legacy wersji nie dodajemy tripów z URL, bo nie mamy API
  // Ta funkcja jest tylko fallbackiem gdy API nie działa

  // 2) Render + wire handlers
  const rerender = async () => {
    const cart = loadCart();
      await renderCart({
        cart,
        onQtyChange: (index, qty) => {
          const next = setItemQty(loadCart(), index, qty);
          saveCart(next);
          rerender();
        },
        onRemoveItem: (index) => {
          const next = removeItem(loadCart(), index);
          saveCart(next);
          rerender();
        }
      });
  };

  await rerender();
}


