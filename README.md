# Dream Travel Sport

Aplikacja do zarządzania wyjazdami sportowymi z systemem zamówień, płatności i punktów lojalnościowych.

## Struktura projektu

- `web/`: Frontend (HTML/CSS/TypeScript) - statyczna aplikacja budowana przez Vite
- `server/`: Backend (Express + Prisma + PostgreSQL) - API REST
- `dist/`: Zbudowany frontend (generowany przez `npm run build`)

## Wymagania

- Node.js 18+ i npm
- Docker i Docker Compose (dla lokalnej bazy danych PostgreSQL)
- Git

## Instalacja i uruchomienie

### 1. Instalacja zależności

```bash
npm install
```

### 2. Konfiguracja bazy danych

#### Opcja A: Docker (zalecane dla developmentu)

```bash
# Uruchom PostgreSQL w Dockerze
npm run db:up

# Sprawdź czy kontener działa
docker ps
```

#### Opcja B: Lokalny PostgreSQL

Jeśli masz zainstalowany PostgreSQL lokalnie, możesz użyć własnej instancji. Upewnij się, że:

- PostgreSQL działa na porcie 5432
- Masz utworzoną bazę danych (lub zostanie utworzona automatycznie)
- Masz odpowiednie uprawnienia

### 3. Konfiguracja zmiennych środowiskowych

#### Backend

Skopiuj plik przykładowy i uzupełnij wartości:

```bash
cp server/env.example server/.env
```

Edytuj `server/.env` i uzupełnij:

```env
# Backend
PORT=3001
CORS_ORIGIN=http://localhost:5173

# Database (PostgreSQL)
# Dla Dockera:
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/dream_travel_sport?schema=public
# Dla lokalnego PostgreSQL zmień zgodnie z konfiguracją

# Przelewy24 (opcjonalne - jeśli nie ustawione, płatności tylko MANUAL_TRANSFER)
P24_MERCHANT_ID=
P24_POS_ID=
P24_API_KEY=
P24_CRC_KEY=
P24_API_URL=https://sandbox.przelewy24.pl  # lub https://secure.przelewy24.pl dla produkcji

# Resend (Email) - opcjonalne
RESEND_API_KEY=
RESEND_FROM_EMAIL=noreply@dreamtravelsport.pl
RESEND_FROM_NAME=Dream Travel Sport

# Bank Account (dla przelewów tradycyjnych)
BANK_ACCOUNT=

# Rate Limiting - IP whitelist dla webhooków P24 (opcjonalne)
P24_WEBHOOK_IPS=

# Admin Dashboard
# Wygeneruj bezpieczny token: openssl rand -hex 32
ADMIN_TOKEN=
```

**Ważne:** Wygeneruj token dla dashboardu administracyjnego:

```bash
# Linux/Mac:
openssl rand -hex 32

# Windows (PowerShell):
-join ((48..57) + (97..102) | Get-Random -Count 64 | ForEach-Object {[char]$_})
```

Skopiuj wygenerowany token do `ADMIN_TOKEN` w `server/.env`.

#### Frontend (opcjonalne)

Domyślnie frontend używa `http://localhost:3001/api` jako URL API. Jeśli chcesz to zmienić:

```bash
cp web/.env.example web/.env  # jeśli istnieje
```

I ustaw `VITE_API_URL` w `web/.env`.

### 4. Przygotowanie bazy danych

```bash
# Wygeneruj Prisma Client
npm run prisma:generate

# Utwórz i zastosuj migracje
npm run prisma:migrate
```

**Uwaga:** Przy pierwszym uruchomieniu `prisma:migrate` zostanie utworzona baza danych i wszystkie tabele.

### 5. Uruchomienie aplikacji

#### Development (dwa terminale)

**Terminal 1 - Backend:**

```bash
npm run dev:server
```

Backend będzie dostępny na `http://localhost:3001`

**Terminal 2 - Frontend:**

```bash
npm run dev
```

Frontend będzie dostępny na `http://localhost:5173`

#### Production Build

```bash
# Zbuduj frontend
npm run build

# Zbuduj backend
npm run build:server

# Uruchom backend
npm run start:server
```

## Dostęp do aplikacji

- **Frontend:** http://localhost:5173
- **Backend API:** http://localhost:3001/api
- **Health Check:** http://localhost:3001/api/health
- **Admin Dashboard:** http://localhost:5173/admin.html

## Przydatne komendy

### Baza danych

```bash
# Uruchom PostgreSQL w Dockerze
npm run db:up

# Zatrzymaj PostgreSQL
npm run db:down

# Otwórz Prisma Studio (GUI do bazy danych)
npm run prisma:studio

# Wygeneruj Prisma Client (po zmianach w schema.prisma)
npm run prisma:generate

# Utwórz nową migrację
npm run prisma:migrate

# Zastosuj migracje (produkcja)
npm run prisma:migrate:deploy
```

### Development

```bash
# Uruchom frontend w trybie dev
npm run dev

# Uruchom backend w trybie dev (z auto-reload)
npm run dev:server

# Formatuj kod
npm run format

# Sprawdź formatowanie
npm run format:check
```

## Struktura API

### Publiczne endpointy

- `GET /api/trips` - Lista wyjazdów
- `GET /api/trips/featured` - Wyróżnione wyjazdy
- `GET /api/trips/:slug` - Szczegóły wyjazdu
- `POST /api/newsletter` - Subskrypcja newslettera
- `POST /api/checkout/sessions` - Utworzenie sesji checkoutu
- `GET /api/checkout/sessions/:id` - Status sesji
- `POST /api/orders` - Utworzenie zamówienia
- `POST /api/orders/:id/payments` - Inicjacja płatności
- `GET /api/health` - Health check
- `GET /api/health/live` - Liveness probe
- `GET /api/health/ready` - Readiness probe

### Admin endpointy (wymagają tokena)

- `GET /api/admin/stats` - Statystyki
- `GET /api/admin/orders` - Lista zamówień
- `GET /api/admin/orders/:id` - Szczegóły zamówienia
- `GET /api/admin/trips` - Lista wyjazdów
- `GET /api/admin/users` - Lista użytkowników
- `GET /api/admin/newsletter` - Lista subskrybentów

**Autoryzacja:** Wszystkie endpointy `/api/admin/*` wymagają nagłówka:

```
Authorization: Bearer <ADMIN_TOKEN>
```

## Funkcjonalności

### Dla użytkowników

- Przeglądanie wyjazdów
- Dodawanie wyjazdów do koszyka
- Proces checkoutu z formularzem uczestników
- System punktów lojalnościowych (Dream Points)
- Magic linki do użycia punktów
- Płatności przez Przelewy24 (BLIK, przelew bankowy)
- Newsletter

### Dla administratorów

- Dashboard administracyjny z statystykami
- Przegląd zamówień
- Zarządzanie wyjazdami
- Lista użytkowników
- Lista subskrybentów newslettera

## Rozwiązywanie problemów

### Błąd: "Database connection failed"

1. Sprawdź czy PostgreSQL działa:

   ```bash
   docker ps  # dla Dockera
   # lub
   psql -U postgres  # dla lokalnego PostgreSQL
   ```

2. Sprawdź `DATABASE_URL` w `server/.env`

3. Upewnij się, że migracje zostały zastosowane:
   ```bash
   npm run prisma:migrate
   ```

### Błąd: "Prisma Client not generated"

```bash
npm run prisma:generate
```

### Błąd: "Port already in use"

Zmień port w `server/.env` (backend) lub `vite.config.ts` (frontend).

### Błąd: "CORS error"

Sprawdź czy `CORS_ORIGIN` w `server/.env` odpowiada URL frontendu (domyślnie `http://localhost:5173`).

## Produkcja

### Wymagane zmiany przed deploymentem

1. **Zmienne środowiskowe:**
   - Ustaw `NODE_ENV=production`
   - Zmień `CORS_ORIGIN` na domenę produkcyjną
   - Użyj produkcyjnego URL P24: `https://secure.przelewy24.pl`
   - Ustaw silny `ADMIN_TOKEN`
   - Skonfiguruj `P24_WEBHOOK_IPS` dla bezpieczeństwa

2. **Baza danych:**
   - Użyj produkcyjnej bazy danych PostgreSQL
   - Zastosuj migracje: `npm run prisma:migrate:deploy`

3. **Build:**

   ```bash
   npm run build
   npm run build:server
   ```

4. **Uruchomienie:**

   ```bash
   npm run start:server
   ```

5. **Frontend:**
   - Zbudowany frontend w `dist/` może być serwowany przez nginx, Vercel, Netlify, itp.

## Bezpieczeństwo

- **Admin Token:** Używaj silnego tokena (min. 32 znaki)
- **Webhook IPs:** W produkcji skonfiguruj `P24_WEBHOOK_IPS` dla dodatkowego bezpieczeństwa
- **HTTPS:** W produkcji używaj HTTPS dla wszystkich połączeń
- **Secrets:** Nigdy nie commituj plików `.env` do repozytorium

## Licencja

Prywatny projekt - Dream Travel Sport
