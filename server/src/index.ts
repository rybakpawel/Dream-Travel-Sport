import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import cron from "node-cron";

import { createApp } from "./app.js";
import { readEnv } from "./env.js";
import { cleanupExpiredSessionsAndTokens } from "./services/cleanup.js";

// Load env from `server/.env` (keeps frontend env separate).
dotenv.config({
  path: resolve(dirname(fileURLToPath(import.meta.url)), "..", ".env")
});

const env = readEnv();
const app = createApp(env);

// Uruchom cleanup wygasłych sesji i tokenów co 5 minut
// Format cron: "*/5 * * * *" = co 5 minut
cron.schedule("*/5 * * * *", async () => {
  try {
    await cleanupExpiredSessionsAndTokens();
  } catch (err) {
    console.error("[cron] Cleanup job failed:", err);
  }
});

console.log("[server] Cleanup job scheduled: every 5 minutes");

app.listen(env.PORT, () => {
  console.log(`[server] listening on http://localhost:${env.PORT}`);
});
