# Wdrożenie backendu (API)

Ten dokument opisuje jak wdrożyć backend aplikacji Dream Travel Sports na produkcję.

## Wybór hostingu

### ⚠️ Cyberfolks a Node.js

**Standardowy hosting Cyberfolks** (shared hosting) oferuje głównie **PHP i Python**, ale **NIE oferuje Node.js**.

**Opcje:**

1. **Cyberfolks VPS** (jeśli dostępne) - możesz zainstalować Node.js samodzielnie
2. **Platformy cloud** (Railway, Render, Fly.io) - najłatwiejsze, zalecane dla początkujących
3. **VPS od innych dostawców** (DigitalOcean, Hetzner, OVH) - więcej kontroli, ale więcej konfiguracji

### Zalecane opcje

| Opcja                          | Trudność            | Koszt       | Zalecane dla          |
| ------------------------------ | ------------------- | ----------- | --------------------- |
| **Railway / Render**           | ⭐ Łatwe            | ~$5-20/mies | Początkujących        |
| **Fly.io**                     | ⭐⭐ Średnie        | ~$5-20/mies | Średniozaawansowanych |
| **VPS (DigitalOcean/Hetzner)** | ⭐⭐⭐ Zaawansowane | ~$5-10/mies | Doświadczonych        |

---

## Opcja 1: Railway (najłatwiejsze) ⭐ Zalecane

Railway to platforma cloud która automatycznie zarządza deploymentem Node.js aplikacji.

### Wymagania

- Konto na [railway.app](https://railway.app) (można przez GitHub)
- PostgreSQL (Railway oferuje managed PostgreSQL)

### Kroki

#### 1. Przygotowanie kodu

Upewnij się, że masz:

- Działający backend lokalnie
- Plik `server/.env` z konfiguracją (do użycia jako referencja)
- Commitnij zmiany do Git (Railway korzysta z Git)

#### 2. Utworzenie projektu na Railway

1. Zaloguj się na [railway.app](https://railway.app)
2. Kliknij "New Project"
3. Wybierz "Deploy from GitHub repo" i wybierz swoje repozytorium
4. Railway automatycznie wykryje Node.js aplikację

#### 3. Konfiguracja zmiennych środowiskowych

W Railway Dashboard → Twoj projekt → Variables:

**Wymagane zmienne:**

```env
NODE_ENV=production
PORT=3000  # Railway ustawia to automatycznie, ale możesz nadpisać
CORS_ORIGIN=https://twoja-domena.pl
DATABASE_URL=postgresql://...  # Będzie ustawione automatycznie (patrz krok 4)
ADMIN_TOKEN=twoj_silny_token_min_32_znaki
```

**Opcjonalne (ale zalecane):**

```env
SERVER_PUBLIC_URL=https://twoj-backend.railway.app
P24_MERCHANT_ID=twoj_merchant_id
P24_POS_ID=twoj_pos_id
P24_REPORT_KEY=twoj_report_key
P24_CRC_KEY=twoj_crc_key
P24_API_URL=https://secure.przelewy24.pl
RESEND_API_KEY=twoj_resend_key
RESEND_FROM_EMAIL=noreply@twoja-domena.pl
BANK_ACCOUNT=twoje_konto_bankowe
```

**Generowanie ADMIN_TOKEN:**

```bash
# Windows PowerShell:
-join ((48..57) + (97..102) | Get-Random -Count 64 | ForEach-Object {[char]$_})

# Linux/Mac:
openssl rand -hex 32
```

#### 4. Dodanie PostgreSQL

1. W Railway Dashboard → Twoj projekt → "New" → "Database" → "PostgreSQL"
2. Railway automatycznie utworzy bazę i ustawi zmienną `DATABASE_URL`
3. **WAŻNE:** Railway używa `DATABASE_URL` zamiast `POSTGRES_URL`

#### 5. Konfiguracja builda

Railway automatycznie wykryje Node.js, ale możesz ustawić:

**Build Command:**

```bash
npm install && npm run build:server
```

**Start Command:**

```bash
npm run start:server
```

Lub w `package.json` możesz dodać:

```json
{
  "scripts": {
    "start": "node server/dist/index.js"
  }
}
```

Railway automatycznie użyje `npm start` jeśli istnieje.

#### 6. Uruchomienie migracji

Po pierwszym deploymencie:

1. Otwórz Railway Dashboard → Twoj projekt → "Deployments" → najnowszy deployment
2. Kliknij "View Logs"
3. Kliknij na terminal (ikonka terminala)
4. Uruchom migracje:

```bash
npm run prisma:migrate:deploy
```

**Alternatywnie** - dodaj do build command:

```bash
npm install && npm run build:server && npm run prisma:migrate:deploy
```

#### 7. Uzyskanie URL backendu

1. Railway Dashboard → Twoj projekt → "Settings" → "Networking"
2. Dodaj "Custom Domain" (opcjonalnie) lub użyj domyślnego URL: `twoj-projekt.railway.app`
3. URL backendu: `https://twoj-projekt.railway.app`

#### 8. Aktualizacja frontendu

Zaktualizuj zmienną `VITE_API_URL` w frontendzie i przebuduj:

```bash
VITE_API_URL="https://twoj-projekt.railway.app/api" npm run build
```

---

## Opcja 2: Render

Render to alternatywa dla Railway, podobna w użyciu.

**📖 Szczegółowy przewodnik:** Zobacz [DEPLOY_RENDER_SUPABASE.md](./DEPLOY_RENDER_SUPABASE.md) dla pełnej instrukcji krok po kroku, w tym konfiguracji z Supabase.

### Szybkie podsumowanie

1. Zaloguj się na [render.com](https://render.com)
2. "New" → "Web Service" → połącz z GitHub repo
3. Ustawienia:
   - **Build Command:** `npm install && npm run prisma:generate && npm run build:server`
   - **Start Command:** `npm run start:server`
   - **Environment:** Node
4. Dodaj zmienne środowiskowe (w tym `DATABASE_URL` z Supabase lub Render PostgreSQL)
5. Po pierwszym deployment uruchom migracje: `npm run prisma:migrate:deploy` (przez Shell w Render)

**Opcje bazy danych:**

- **Supabase** (zalecane) - zobacz szczegółowy przewodnik w `DEPLOY_RENDER_SUPABASE.md`
- **Render PostgreSQL** - Render Dashboard → "New" → "PostgreSQL" (automatycznie ustawia `DATABASE_URL`)

**Główne różnice od Railway:**

- Render ma darmowy tier (z ograniczeniami)
- Wymaga potwierdzenia emaila
- Może mieć wolniejsze cold start (na free tier)

---

## Opcja 3: VPS (DigitalOcean, Hetzner, OVH, Cyberfolks VPS)

Jeśli masz VPS (Virtual Private Server), możesz zainstalować Node.js i PostgreSQL samodzielnie.

### Wymagania

- VPS z Ubuntu 22.04 LTS (lub podobny Linux)
- Dostęp SSH do serwera
- Podstawowa znajomość Linuksa

### Kroki

#### 1. Połączenie z serwerem

```bash
ssh uzytkownik@twoj-serwer.pl
```

#### 2. Instalacja Node.js

```bash
# Aktualizacja systemu
sudo apt update && sudo apt upgrade -y

# Instalacja Node.js 20.x (LTS)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Weryfikacja
node --version  # powinno pokazać v20.x.x
npm --version
```

#### 3. Instalacja PostgreSQL

```bash
# Instalacja PostgreSQL
sudo apt install -y postgresql postgresql-contrib

# Startowanie serwisu
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Utworzenie użytkownika i bazy danych
sudo -u postgres psql
```

W psql:

```sql
CREATE USER dreamtravel WITH PASSWORD 'silne_haslo';
CREATE DATABASE dream_travel_sport OWNER dreamtravel;
\q
```

#### 4. Instalacja PM2 (process manager)

PM2 utrzymuje aplikację przy życiu i automatycznie restartuje po błędach.

```bash
sudo npm install -g pm2
```

#### 5. Przygotowanie aplikacji na serwerze

```bash
# Utworzenie katalogu aplikacji
mkdir -p ~/app
cd ~/app

# Sklonowanie repozytorium (lub użyj Git pull jeśli już masz)
git clone https://github.com/twoj-uzytkownik/twoj-repo.git .
# LUB: jeśli używasz SSH key
git clone git@github.com:twoj-uzytkownik/twoj-repo.git .

# Instalacja zależności
npm install

# Build aplikacji
npm run build:server
```

#### 6. Konfiguracja zmiennych środowiskowych

```bash
# Skopiuj przykładowy plik .env
cp server/env.example server/.env

# Edytuj .env
nano server/.env
```

Ustaw wszystkie wymagane zmienne (patrz Railway - krok 3).

**DATABASE_URL dla lokalnej bazy:**

```env
DATABASE_URL=postgresql://dreamtravel:silne_haslo@localhost:5432/dream_travel_sport?schema=public
```

#### 7. Uruchomienie migracji

```bash
npm run prisma:migrate:deploy
```

#### 8. Konfiguracja PM2

Utwórz plik `ecosystem.config.js` w katalogu głównym projektu:

```javascript
module.exports = {
  apps: [
    {
      name: "dream-travel-api",
      script: "server/dist/index.js",
      cwd: "/home/uzytkownik/app", // Zmień na ścieżkę do Twojej aplikacji
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PORT: 3001
      },
      error_file: "./logs/pm2-error.log",
      out_file: "./logs/pm2-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s"
    }
  ]
};
```

**Uruchomienie z PM2:**

```bash
pm2 start ecosystem.config.js
pm2 save  # Zapisuje konfigurację
pm2 startup  # Uruchamia PM2 przy starcie systemu (wykonaj komendę którą wyświetli)
```

**Przydatne komendy PM2:**

```bash
pm2 list              # Lista procesów
pm2 logs              # Logi
pm2 restart all       # Restart wszystkich
pm2 stop all          # Zatrzymanie
pm2 delete all        # Usunięcie z PM2
```

#### 9. Konfiguracja Nginx (reverse proxy)

Nginx przekierowuje ruch z portu 80/443 na Twoją aplikację Node.js.

```bash
# Instalacja Nginx
sudo apt install -y nginx

# Utworzenie konfiguracji
sudo nano /etc/nginx/sites-available/dream-travel-api
```

Zawartość pliku:

```nginx
server {
    listen 80;
    server_name api.twoja-domena.pl;  # Zmień na swoją domenę

    location / {
        proxy_pass http://localhost:3001;  # Port Twojej aplikacji Node.js
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
# Aktywacja konfiguracji
sudo ln -s /etc/nginx/sites-available/dream-travel-api /etc/nginx/sites-enabled/

# Test konfiguracji
sudo nginx -t

# Restart Nginx
sudo systemctl restart nginx
sudo systemctl enable nginx
```

#### 10. Konfiguracja SSL (Let's Encrypt)

```bash
# Instalacja Certbot
sudo apt install -y certbot python3-certbot-nginx

# Uzyskanie certyfikatu
sudo certbot --nginx -d api.twoja-domena.pl

# Certbot automatycznie zaktualizuje Nginx i ustawi auto-renewal
```

#### 11. Konfiguracja firewall

```bash
# Ustawienie firewall (UFW)
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP
sudo ufw allow 443/tcp   # HTTPS
sudo ufw enable
```

---

## Wspólne kroki (wszystkie opcje)

### Przed deploymentem

1. **Ustaw wszystkie zmienne środowiskowe** (patrz Railway - krok 3)
2. **Przetestuj lokalnie** z produkcyjnymi zmiennymi
3. **Zrób backup** bazy danych (jeśli migrujesz z dev)

### Po deploymentem

1. **Sprawdź health endpoint:**

```bash
curl https://twoj-backend-url.pl/api/health
```

Powinno zwrócić `{"status":"ok"}`

2. **Sprawdź logi** pod kątem błędów

3. **Zaktualizuj frontend** z nowym URL API

4. **Przetestuj** pełny flow (dodanie do koszyka, checkout, płatność)

---

## Rozwiązywanie problemów

### Problem: "Database connection failed"

- Sprawdź `DATABASE_URL` - czy jest poprawny?
- Sprawdź czy baza danych jest dostępna (dla VPS: `sudo systemctl status postgresql`)
- Dla cloud baz (Railway/Render): sprawdź czy `sslmode=require` jest w URL
- Sprawdź firewall - czy port PostgreSQL (5432) jest dostępny?

### Problem: "CORS error" w przeglądarce

- Sprawdź `CORS_ORIGIN` - czy zawiera URL frontendu?
- Upewnij się, że frontend używa HTTPS jeśli backend używa HTTPS

### Problem: "Admin token invalid"

- Sprawdź czy `ADMIN_TOKEN` ma minimum 32 znaki
- Upewnij się, że token jest poprawnie ustawiony (bez cudzysłowów w .env)

### Problem: Aplikacja się nie uruchamia (VPS)

```bash
# Sprawdź logi PM2
pm2 logs

# Sprawdź czy aplikacja działa
pm2 list

# Sprawdź port
sudo netstat -tlnp | grep 3001
```

### Problem: Nginx zwraca 502 Bad Gateway

- Sprawdź czy aplikacja Node.js działa: `pm2 list`
- Sprawdź logi Nginx: `sudo tail -f /var/log/nginx/error.log`
- Sprawdź czy port w Nginx (proxy_pass) odpowiada portowi aplikacji

---

## Aktualizacja aplikacji (deployment nowej wersji)

### Railway/Render

1. Commitnij zmiany do Git
2. Push do repozytorium
3. Platforma automatycznie zbuduje i wdroży nową wersję

### VPS

```bash
# Połącz się z serwerem
ssh uzytkownik@twoj-serwer.pl
cd ~/app

# Pobierz najnowsze zmiany
git pull

# Zainstaluj nowe zależności (jeśli są)
npm install

# Zbuduj aplikację
npm run build:server

# Uruchom migracje (jeśli są nowe)
npm run prisma:migrate:deploy

# Restart aplikacji
pm2 restart all

# Sprawdź logi
pm2 logs
```

---

## Backup bazy danych

### Railway/Render

Użyj wbudowanych narzędzi backup w dashboardzie platformy.

### VPS (PostgreSQL)

```bash
# Backup
pg_dump -U dreamtravel -d dream_travel_sport > backup_$(date +%Y%m%d).sql

# Restore
psql -U dreamtravel -d dream_travel_sport < backup_20250115.sql
```

---

## Monitoring i logi

### Railway/Render

- Logi dostępne w dashboardzie platformy
- Railway/Render oferują podstawowe metryki (CPU, RAM, requesty)

### VPS (PM2)

```bash
pm2 logs              # Wszystkie logi
pm2 logs --lines 100  # Ostatnie 100 linii
pm2 monit             # Monitor w czasie rzeczywistym
```

---

## Bezpieczeństwo - checklista

- ✅ `NODE_ENV=production` jest ustawione
- ✅ `ADMIN_TOKEN` ma minimum 32 znaki i jest losowy
- ✅ `DATABASE_URL` używa silnego hasła
- ✅ HTTPS jest włączony (Let's Encrypt na VPS)
- ✅ Firewall jest skonfigurowany (VPS)
- ✅ `CORS_ORIGIN` zawiera tylko dozwolone domeny
- ✅ Zmienne środowiskowe nie są commitowane do Git
- ✅ Backup bazy danych jest regularnie wykonywany

---

## Koszty (szacunkowe)

- **Railway:** ~$5-20/mies (w zależności od użycia)
- **Render:** Darmowy tier dostępny (z ograniczeniami), płatny od ~$7/mies
- **VPS (DigitalOcean/Hetzner):** ~$5-10/mies (dla małej aplikacji)
- **Baza danych:** Zazwyczaj wliczona w Railway/Render, na VPS - własny serwer

---

## Następne kroki

Po wdrożeniu backendu:

1. Zaktualizuj frontend z nowym URL API
2. Przetestuj wszystkie funkcjonalności
3. Skonfiguruj monitoring (opcjonalnie)
4. Ustaw automatyczne backup bazy danych
5. Skonfiguruj alerty (jeśli dostępne)
