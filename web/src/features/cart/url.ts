export function readQueryTrip(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get("trip");
}

export function removeTripFromUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete("trip");
  window.history.replaceState({}, "", url.toString());
}


