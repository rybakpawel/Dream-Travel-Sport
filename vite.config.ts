import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // Frontend lives in /web, backend will live in /server
  root: "web",

  // Make the built site deployable as static files even under a subpath.
  base: "./",

  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, "web/index.html"),
        koszyk: resolve(__dirname, "web/koszyk.html"),
        platnosc: resolve(__dirname, "web/platnosc.html"),
        dreamPoints: resolve(__dirname, "web/dream-points.html"),
        diy: resolve(__dirname, "web/diy.html"),
        spelnijMarzenia: resolve(__dirname, "web/spelnij-marzenia.html"),
        wspolpraca: resolve(__dirname, "web/wspolpraca.html"),
        admin: resolve(__dirname, "web/admin.html"),
        tripDetails: resolve(__dirname, "web/trip-details.html")
      }
    }
  }
});


