import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).optional(),
  PORT: z.coerce.number().int().positive().default(3001),
  CORS_ORIGIN: z.string().min(1).default("http://localhost:5173"),
  DATABASE_URL: z.string().min(1),
  // Przelewy24 (opcjonalne - jeśli nie ustawione, płatności będą tylko MANUAL_TRANSFER)
  P24_MERCHANT_ID: z.string().optional(),
  P24_POS_ID: z.string().optional(),
  // Preferowany klucz do autoryzacji REST API (w panelu jako "Klucz do raportów")
  P24_REPORT_KEY: z.string().optional(),
  // Alias (PL) dla wygody
  P24_RAPORT_KEY: z.string().optional(),
  // Back-compat: wcześniej używaliśmy P24_API_KEY jako "Klucz do raportów"
  P24_API_KEY: z.string().optional(),
  P24_CRC_KEY: z.string().optional(),
  P24_API_URL: z.string().url().default("https://sandbox.przelewy24.pl"),
  // Resend (opcjonalne - jeśli nie ustawione, emaile nie będą wysyłane)
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().email().default("noreply@dreamtravelsport.pl"),
  RESEND_FROM_NAME: z.string().default("Dream Travel Sport"),
  // Resend: Audience ID dla newslettera (opcjonalne, ale wymagane jeśli chcesz wysyłać newsletter przez Resend Broadcasts)
  // Ustaw w panelu Resend -> Audiences -> (wybrana lista) -> ID
  RESEND_NEWSLETTER_AUDIENCE_ID: z.string().optional(),
  // Resend: Nazwa Audience (lista) dla newslettera. Jeśli ustawione, a ID nie jest podane,
  // backend spróbuje znaleźć lub utworzyć Audience o tej nazwie i użyje go do zapisu kontaktów.
  RESEND_NEWSLETTER_AUDIENCE_NAME: z.string().optional(),
  // Bank account dla przelewów tradycyjnych (opcjonalne)
  BANK_ACCOUNT: z.string().optional(),

  // Admin alert: zaległe rezerwacje dla przelewu tradycyjnego (w godzinach).
  // Domyślnie 48h.
  MANUAL_TRANSFER_OVERDUE_HOURS: z.coerce.number().int().positive().default(48),
  // Rate limiting - IP whitelist dla webhooków P24 (opcjonalne, oddzielone przecinkami)
  P24_WEBHOOK_IPS: z.string().optional(),

  // Publiczny URL backendu (potrzebne m.in. do webhooków P24). W dev możesz użyć np. ngrok.
  SERVER_PUBLIC_URL: z.string().url().optional(),

  // Rezerwacja miejsc dla płatności P24 (minuty). Po tym czasie nieopłacone zamówienia są anulowane,
  // a miejsca wracają do puli. Domyślnie 120 minut (2h).
  P24_RESERVATION_TTL_MINUTES: z.coerce.number().int().positive().default(120),

  // Admin Dashboard (opcjonalne - jeśli nie ustawione lub pusty, dashboard nie będzie dostępny)
  ADMIN_TOKEN: z
    .string()
    .optional()
    .refine(
      (val) => {
        // Jeśli token jest ustawiony i nie jest pusty, musi mieć minimum 32 znaki
        if (val && val.trim().length > 0) {
          return val.length >= 32;
        }
        // Pusty string lub undefined jest OK
        return true;
      },
      {
        message: "Admin token must be at least 32 characters if provided"
      }
    )
    .transform((val) => {
      // Konwertuj pusty string na undefined
      if (val && val.trim().length === 0) {
        return undefined;
      }
      return val;
    })
});

export type Env = z.infer<typeof EnvSchema>;

export function readEnv(): Env {
  return EnvSchema.parse(process.env);
}
