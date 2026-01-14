# `server/` (backend)

Backend w **Express** + **Prisma**.

## Konfiguracja

1. Skopiuj plik konfiguracyjny:

- `server/env.example` → `server/.env`

2. Uruchom bazę danych (PostgreSQL) w Dockerze (opcjonalnie, ale rekomendowane):

- `docker compose -f server/docker-compose.yml up -d`

## Uruchomienie (dev)

W osobnym terminalu:

- `npm run dev:server`

Endpoint testowy:

- `GET /api/health`

## Prisma

Przykładowe komendy (z root projektu):

- `npm run prisma:generate` - generuj Prisma Client
- `npm run prisma:migrate` - uruchom migracje (tworzy tabele)
- `npm run prisma:studio` - otwórz Prisma Studio (GUI do bazy)
- `npm run prisma -- db seed` - (opcjonalnie) uruchom seed (obecnie pusty - placeholder data nie jest seedowana)

## Deployment (produkcja)

### Zmiany w konfiguracji

Podczas deploymentu na produkcję musisz zaktualizować zmienne środowiskowe w `server/.env`:

**Wymagane zmiany:**

1. **`DATABASE_URL`** - użyj produkcyjnej bazy danych:

   ```
   DATABASE_URL=postgresql://user:password@prod-host:5432/dream_travel_sport?schema=public&sslmode=require
   ```

   - Cloudowe bazy (Supabase, Neon, Railway) wymagają `?sslmode=require`
   - Lokalna baza na VPS: usuń `sslmode=require`

2. **`CORS_ORIGIN`** - URL frontendu w produkcji:

   ```
   CORS_ORIGIN=https://twoja-domena.pl
   ```

   - Możesz podać wiele originów oddzielonych przecinkami: `https://domena.pl,https://www.domena.pl`

3. **`NODE_ENV`** - ustaw na `production`:

   ```
   NODE_ENV=production
   ```

   - W produkcji API nie zwraca wrażliwych danych (np. tokenów magic linków)

4. **`PORT`** - port na którym działa serwer (zwykle ustawiany przez hosting):

   ```
   PORT=3001
   ```

5. **Przelewy24** - produkcyjne dane:
   ```
   P24_MERCHANT_ID=twoj_merchant_id
   P24_POS_ID=twoj_pos_id
   P24_API_KEY=twoj_api_key
   P24_CRC_KEY=twoj_crc_key
   P24_API_URL=https://secure.przelewy24.pl  # zmień z sandbox na produkcję!
   ```

### Typowe scenariusze deploymentu

**Railway / Render / Fly.io:**

- Dodaj zmienne środowiskowe w dashboardzie
- Ustaw `DATABASE_URL` do ich managed PostgreSQL lub zewnętrznej bazy
- Ustaw `CORS_ORIGIN` na URL frontendu
- `PORT` jest zwykle ustawiany automatycznie

**VPS (np. DigitalOcean, Hetzner):**

- Zainstaluj PostgreSQL na serwerze lub użyj Dockera
- Skonfiguruj reverse proxy (nginx) przed aplikacją
- Ustaw zmienne środowiskowe w systemd service lub `.env`
- Użyj PM2 lub systemd do zarządzania procesem

**Vercel / Netlify Functions:**

- Te platformy są głównie dla frontendu
- Backend Express można hostować jako serverless functions, ale wymaga adaptacji
- Lepsze: Railway/Render dla pełnego Node.js backendu

### Przed deploymentem

1. **Uruchom migracje na produkcji:**

   ```bash
   npm run prisma:migrate:deploy  # dla produkcji (bez interakcji)
   ```

2. **Zbuduj aplikację:**

   ```bash
   npm run build:server
   ```

3. **Uruchom:**
   ```bash
   npm run start:server
   ```

### Bezpieczeństwo

- **Nigdy nie commituj** pliku `server/.env` do git (jest w `.gitignore`)
- Używaj silnych haseł do bazy danych
- W produkcji zawsze używaj HTTPS
- Ustaw `NODE_ENV=production` dla lepszej wydajności i bezpieczeństwa
