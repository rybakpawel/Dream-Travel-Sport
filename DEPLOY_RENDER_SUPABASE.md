# Wdrożenie backendu na Render z Supabase

Ten dokument opisuje szczegółowe kroki wdrożenia backendu na Render z bazą danych Supabase.

## Odpowiedzi na kluczowe pytania

### 1. Czy wrzucać cały projekt czy tylko katalog `server/`?

**Cały projekt!**

Dlaczego:

- `package.json` jest w **root** projektu (nie w `server/`)
- Skrypty build (`npm run build:server`) są w root `package.json`
- Render potrzebuje całego repozytorium, żeby móc zainstalować zależności i zbudować aplikację

**Struktura na GitHub:**

```
dream-travel-sports/
├── package.json          ← Render potrzebuje tego
├── server/
│   ├── src/
│   ├── prisma/
│   └── .env              ← NIE commitować do Git!
├── web/                  ← Może być, nie przeszkadza
└── dist/                 ← Może być w .gitignore
```

### 2. Supabase vs Render PostgreSQL - co wybrać?

**Supabase jest świetnym wyborem!** Oto porównanie:

| Opcja                 | Zalety                                                                                                                                                                 | Wady                                      |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| **Supabase**          | ✅ Darmowy tier (500MB) <br> ✅ Łatwa konfiguracja <br> ✅ Wbudowany dashboard <br> ✅ Backup automatyczny <br> ✅ HTTPS/SSL out of the box <br> ✅ Connection pooling | ⚠️ Zewnętrzna usługa (ale to też zaleta)  |
| **Render PostgreSQL** | ✅ Wszystko w jednym miejscu <br> ✅ Automatyczne `DATABASE_URL`                                                                                                       | ⚠️ Mniej funkcji <br> ⚠️ Może być droższe |

**Rekomendacja:** Supabase - ma lepszy darmowy tier i więcej funkcji.

### 3. Czy trzeba zmieniać kod dla Supabase?

**NIE!** Prisma używa standardowego PostgreSQL.

Supabase używa standardowego PostgreSQL z SSL - wystarczy zmienić tylko `DATABASE_URL`. Kod pozostaje bez zmian.

---

## Krok po kroku: Render + Supabase

### Krok 1: Przygotowanie repozytorium na GitHub

Upewnij się, że Twój projekt jest na GitHub:

```bash
# Jeśli jeszcze nie masz repo na GitHub
git init
git add .
git commit -m "Initial commit"

# Utwórz repo na GitHub.com, potem:
git remote add origin https://github.com/twoj-uzytkownik/twoj-repo.git
git push -u origin main
```

**WAŻNE:** Sprawdź `.gitignore` - upewnij się, że `server/.env` jest ignorowany:

```gitignore
# .gitignore powinien zawierać:
server/.env
.env
.env.*
node_modules/
dist/
server/dist/
```

### Krok 2: Konfiguracja Supabase

📖 **Szczegółowy przewodnik:** Zobacz [SUPABASE_SETUP.md](./SUPABASE_SETUP.md) dla kompletnej instrukcji konfiguracji Supabase.

#### Szybkie podsumowanie

1. Utwórz projekt na [supabase.com](https://supabase.com)
2. Skopiuj `DATABASE_URL` z Settings → Database → Connection string
3. Format: `postgresql://postgres:TWOJE_HASLO@db.xxxxx.supabase.co:5432/postgres?sslmode=require`
4. (Opcjonalnie) Przetestuj lokalnie przed deploymentem

**Zobacz SUPABASE_SETUP.md** dla:

- Szczegółowych kroków utworzenia projektu
- Wyjaśnienia różnych typów połączeń
- Instrukcji testowania lokalnie
- Rozwiązywania problemów
- Best practices

### Krok 3: Konfiguracja Render

#### 3.1. Utworzenie konta

1. Zaloguj się na [render.com](https://render.com) (można przez GitHub)
2. Potwierdź email (Render wymaga potwierdzenia)

#### 3.2. Utworzenie Web Service

1. W Render Dashboard kliknij **"New +"** → **"Web Service"**
2. Połącz z GitHub:
   - Kliknij **"Connect account"** jeśli pierwszy raz
   - Wybierz repozytorium z projektem
   - Kliknij **"Connect"**

3. Wypełnij formularz:

   **Basic Settings:**
   - **Name:** `dream-travel-api` (lub dowolna nazwa)
   - **Environment:** `Node`
   - **Region:** Wybierz najbliższą (np. `Frankfurt` dla Polski)
   - **Branch:** `main` (lub Twoja główna gałąź)
   - **Root Directory:** _(zostaw puste - Render użyje root)_

   **Build & Deploy:**
   - **Build Command:** `npm install --include=dev && npx prisma generate --schema=server/prisma/schema.prisma && npm run build:server`
   - **Start Command:** `npm run start:server`

   **⚠️ WAŻNE - Build Command:**
   - `--include=dev` - instaluje również devDependencies (potrzebne dla @types/express podczas kompilacji TypeScript)
   - `npx prisma generate` - generuje Prisma Client (bezpośrednio, bez dotenv, bo zmienne są w środowisku Render)
   - Migracje uruchomimy ręcznie po pierwszym deploymencie

   **Plan:**
   - **Free:** Darmowy tier (z ograniczeniami)
   - **Starter:** $7/mies (zalecane dla produkcji)

4. Kliknij **"Create Web Service"**

#### 3.3. Konfiguracja zmiennych środowiskowych

W Render Dashboard → Twoj Web Service → **"Environment"**:

**Wymagane zmienne:**

```env
NODE_ENV=production
PORT=10000  # Render automatycznie ustawia port, ale możesz użyć 10000 (domyślny)
DATABASE_URL=postgresql://postgres:TWOJE_HASLO@db.xxxxx.supabase.co:5432/postgres?sslmode=require
CORS_ORIGIN=https://twoja-domena.pl
ADMIN_TOKEN=twoj_silny_token_min_32_znaki
```

**Generowanie ADMIN_TOKEN:**

```bash
# Windows PowerShell:
-join ((48..57) + (97..102) | Get-Random -Count 64 | ForEach-Object {[char]$_})

# Linux/Mac:
openssl rand -hex 32
```

**Opcjonalne (ale zalecane):**

```env
SERVER_PUBLIC_URL=https://dream-travel-api.onrender.com
P24_MERCHANT_ID=twoj_merchant_id
P24_POS_ID=twoj_pos_id
P24_REPORT_KEY=twoj_report_key
P24_CRC_KEY=twoj_crc_key
P24_API_URL=https://secure.przelewy24.pl
RESEND_API_KEY=twoj_resend_key
RESEND_FROM_EMAIL=noreply@twoja-domena.pl
BANK_ACCOUNT=twoje_konto_bankowe
```

**Jak dodać zmienne:**

1. Kliknij **"Add Environment Variable"**
2. Wpisz nazwę (np. `DATABASE_URL`)
3. Wklej wartość
4. Kliknij **"Save Changes"**
5. Powtórz dla wszystkich zmiennych

#### 3.4. Uruchomienie migracji

Po pierwszym deploymencie:

1. Render Dashboard → Twoj Web Service → **"Shell"** (ikonka terminala)
2. W otwartym terminalu uruchom:

```bash
npm run prisma:migrate:deploy
```

**Alternatywnie** - możesz dodać do Build Command:

```bash
npm install && npm run prisma:generate && npm run build:server && npm run prisma:migrate:deploy
```

Ale lepiej uruchomić migracje ręcznie pierwszy raz, żeby zobaczyć czy są błędy.

#### 3.5. Sprawdzenie deploymentu

1. Render Dashboard → Twoj Web Service
2. Poczekaj aż deployment się zakończy (zielony status)
3. Kliknij na URL (np. `https://dream-travel-api.onrender.com`)
4. Dodaj `/api/health` do URL: `https://dream-travel-api.onrender.com/api/health`
5. Powinno zwrócić: `{"status":"ok"}`

#### 3.6. (Opcjonalnie) Ustawienie custom domain

1. Render Dashboard → Twoj Web Service → **"Settings"** → **"Custom Domains"**
2. Kliknij **"Add Custom Domain"**
3. Wpisz domenę (np. `api.twoja-domena.pl`)
4. Render wyświetli instrukcje konfiguracji DNS
5. Skonfiguruj DNS u swojego rejestratora domeny
6. Render automatycznie wyda certyfikat SSL (Let's Encrypt)

### Krok 4: Aktualizacja frontendu

Po wdrożeniu backendu, zaktualizuj frontend z nowym URL API:

```bash
# Lokalnie
VITE_API_URL="https://dream-travel-api.onrender.com/api" npm run build

# Lub jeśli masz custom domain:
VITE_API_URL="https://api.twoja-domena.pl/api" npm run build
```

Potem wyślij zbudowany frontend na Cyberfolks (jak w `DEPLOY_FRONTEND.md`).

---

## FAQ

### Czy muszę używać pgbouncer w DATABASE_URL?

Nie, nie musisz. Dla małych/średnich aplikacji lepszy jest direct connection:

**Z pgbouncer:**

```
postgresql://postgres:PASSWORD@db.xxxxx.supabase.co:5432/postgres?pgbouncer=true
```

**Bez pgbouncer (zalecane):**

```
postgresql://postgres:PASSWORD@db.xxxxx.supabase.co:5432/postgres?sslmode=require
```

### Jak dodać migracje po pierwszym deployment?

1. Render Dashboard → Twoj Web Service → **"Shell"**
2. Uruchom: `npm run prisma:migrate:deploy`

### Render zwraca błąd podczas builda - "Prisma Client not generated"

Upewnij się, że Build Command zawiera `prisma:generate`:

```bash
npm install && npm run prisma:generate && npm run build:server
```

### Czy mogę użyć Render PostgreSQL zamiast Supabase?

Tak! Zamiast Supabase możesz:

1. Render Dashboard → **"New +"** → **"PostgreSQL"**
2. Utwórz bazę
3. Render automatycznie ustawi zmienną `DATABASE_URL`
4. Kod pozostaje bez zmian - tylko `DATABASE_URL` jest inny

### Render free tier - co muszę wiedzieć?

**Ograniczenia free tier:**

- Aplikacja "śpi" po 15 minutach bezczynności
- Pierwsze żądanie po uśpieniu może trwać 30-60 sekund (cold start)
- Ograniczenia CPU/RAM
- Nie można użyć custom domain (tylko `xxx.onrender.com`)

**Dla produkcji:** Zalecany plan Starter ($7/mies) - brak uśpienia, więcej zasobów.

---

## Podsumowanie - co zmienić w kodzie?

**ODPOWIEDŹ: NIC!**

Kod pozostaje bez zmian. Jedyne co się zmienia to:

1. ✅ `DATABASE_URL` w zmiennych środowiskowych (Supabase zamiast lokalnej bazy)
2. ✅ Inne zmienne środowiskowe (CORS_ORIGIN, SERVER_PUBLIC_URL, etc.)
3. ✅ Kod pozostaje identyczny - Prisma działa z każdą bazą PostgreSQL

Prisma jest ORM-agnostic - używa standardowego PostgreSQL, więc działa z:

- Lokalnym PostgreSQL
- Docker PostgreSQL
- Supabase
- Render PostgreSQL
- Railway PostgreSQL
- DigitalOcean Managed Database
- AWS RDS
- itd.

Wszystko działa poprzez `DATABASE_URL` - to wszystko!
