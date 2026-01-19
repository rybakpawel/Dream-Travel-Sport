import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { copyFileSync, existsSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Plugin to copy .htaccess file to dist during build
const copyHtaccessPlugin = () => {
  return {
    name: "copy-htaccess",
    closeBundle() {
      const htaccessSource = resolve(__dirname, "web/.htaccess");
      const htaccessDest = resolve(__dirname, "dist/.htaccess");
      if (existsSync(htaccessSource)) {
        copyFileSync(htaccessSource, htaccessDest);
        console.log("✓ Copied .htaccess to dist/");
      }
    }
  };
};

export default defineConfig({
  // Frontend lives in /web, backend will live in /server
  root: "web",

  // Make the built site deployable as static files even under a subpath.
  base: "./",

  plugins: [copyHtaccessPlugin()],

  build: {
    outDir: "../dist",
    emptyOutDir: true,
    // Ensure deterministic file hashing for cache busting
    rollupOptions: {
      output: {
        // Use hash in filenames for better cache busting
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: (assetInfo) => {
          const info = assetInfo.name?.split(".") ?? [];
          const ext = info[info.length - 1];
          if (/png|jpe?g|svg|gif|tiff|bmp|ico/i.test(ext ?? "")) {
            return `assets/images/[name]-[hash][extname]`;
          }
          if (/woff2?|eot|ttf|otf/i.test(ext ?? "")) {
            return `assets/fonts/[name]-[hash][extname]`;
          }
          return `assets/[name]-[hash][extname]`;
        }
      },
      input: {
        index: resolve(__dirname, "web/index.html"),
        koszyk: resolve(__dirname, "web/koszyk.html"),
        platnosc: resolve(__dirname, "web/platnosc.html"),
        dreamPoints: resolve(__dirname, "web/dream-points.html"),
        diy: resolve(__dirname, "web/diy.html"),
        spelnijMarzenia: resolve(__dirname, "web/spelnij-marzenia.html"),
        wspolpraca: resolve(__dirname, "web/wspolpraca.html"),
        oMnie: resolve(__dirname, "web/o-mnie.html"),
        admin: resolve(__dirname, "web/admin.html"),
        tripDetails: resolve(__dirname, "web/trip-details.html")
      }
    }
  }
});
