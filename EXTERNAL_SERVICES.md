# Konfiguracja Zewnętrznych Serwisów

Ten dokument opisuje wszystkie zewnętrzne serwisy, które musisz skonfigurować dla aplikacji Dream Travel Sport.

## 📋 Wymagane Serwisy

### 1. PostgreSQL (Baza Danych) ⚠️ WYMAGANE

**Opis:** Baza danych PostgreSQL do przechowywania danych aplikacji (wyjazdy, zamówienia, użytkownicy, płatności, itp.)

**Opcje konfiguracji:**

#### Opcja A: Docker (Zalecane dla developmentu)

```bash
npm run db:up
```

Używa `server/docker-compose.yml` do uruchomienia lokalnej instancji PostgreSQL.

#### Opcja B: Lokalny PostgreSQL

Zainstaluj PostgreSQL lokalnie i skonfiguruj:

- Port: 5432 (domyślny)
- Utwórz bazę danych: `dream_travel_sport`
- Użytkownik: `postgres` (lub własny)
- Hasło: `postgres` (lub własne)

#### Opcja C: Zewnętrzny PostgreSQL (Produkcja)

Użyj usługi cloudowej:

- **Supabase** (darmowy plan: 500 MB, ⚠️ auto-pause po 7 dniach bezczynności)
- **Railway** ($5/miesiąc, bez auto-pause, 5 GB)
- **Render** ($7/miesiąc, bez auto-pause, 1 GB)
- **Neon** (darmowy plan z auto-pause, ale można użyć keep-alive)
- **Heroku Postgres** (od $5/miesiąc)
- **AWS RDS** (od ~$15/miesiąc)
- **DigitalOcean Managed Databases** (od $15/miesiąc)

**Zmienna środowiskowa:**

```env
DATABASE_URL=postgresql://user:password@host:5432/dream_travel_sport?schema=public
```

**Po konfiguracji:**

```bash
# Wygeneruj Prisma Client
npm run prisma:generate

# Uruchom migracje
npm run prisma:migrate
```

---

## 🔧 Opcjonalne Serwisy (Zalecane)

### 2. Przelewy24 (Bramka Płatnicza) 💳

**Opis:** Integracja z Przelewy24 do obsługi płatności online. Bez tego serwisu dostępne będą tylko płatności przelewem tradycyjnym.

**Jak skonfigurować:**

1. **Zarejestruj się w Przelewy24:**
   - Przejdź na https://www.przelewy24.pl
   - Zarejestruj konto handlowe
   - Zweryfikuj firmę (wymagane dla produkcji)

2. **Pobierz dane dostępowe:**
   - Zaloguj się do panelu Przelewy24
   - Przejdź do sekcji "API" lub "Integracja"
   - Skopiuj:
     - `MERCHANT_ID` (ID Sprzedawcy)
     - `POS_ID` (ID Punktu Sprzedaży)
     - `REPORT_KEY` / **"Klucz do raportów"** (REST API key do autoryzacji Basic)
     - `CRC_KEY` (Klucz CRC - do weryfikacji webhooków)

3. **Skonfiguruj webhook:**
   - W panelu Przelewy24 ustaw URL webhooka: `https://twoja-domena.pl/api/payments/webhook`
   - Dla developmentu możesz użyć narzędzia jak ngrok do tunelowania

4. **Ustaw zmienne środowiskowe:**

```env
# Sandbox (testy)
P24_MERCHANT_ID=twoj_merchant_id
P24_POS_ID=twoj_pos_id
P24_REPORT_KEY=twoj_report_key
# (opcjonalnie) alias/back-compat:
# P24_API_KEY=twoj_report_key
P24_CRC_KEY=twoj_crc_key
P24_API_URL=https://sandbox.przelewy24.pl
SERVER_PUBLIC_URL=https://twoj-backend.example.com

# Produkcja
P24_API_URL=https://secure.przelewy24.pl
```

5. **Opcjonalnie - Whitelist IP dla webhooków (bezpieczeństwo):**

```env
P24_WEBHOOK_IPS=185.68.12.10,185.68.12.11,185.68.12.0/24
```

Lista IP Przelewy24 (sprawdź w dokumentacji P24 aktualne IP).

**Bez konfiguracji:** Aplikacja będzie działać, ale płatności online nie będą dostępne - tylko przelew tradycyjny.

---

### 3. Resend (Serwis Emailowy) 📧

**Opis:** Serwis do wysyłania emaili transakcyjnych (potwierdzenia zamówień, instrukcje płatności, magic links, itp.)

**⚠️ WAŻNE: Wymagania dotyczące domeny**

- **Weryfikacja domeny jest wymagana** - nie możesz używać darmowych domen (Gmail, Yahoo, Outlook)
- **Nieograniczona liczba adresów email** - możesz używać dowolnej liczby adresów z Twojej zweryfikowanej domeny
- **Własna domena jest konieczna** - musisz mieć własną domenę (np. `dreamtravelsport.pl`)
- **Rekordy DNS** - musisz dodać rekordy SPF, DKIM i DMARC w DNS Twojej domeny

**Jak skonfigurować:**

1. **Zarejestruj się w Resend:**
   - Przejdź na https://resend.com
   - Utwórz darmowe konto (3,000 emaili/miesiąc, 100/dzień w darmowym planie)

2. **Zweryfikuj domenę (WYMAGANE):**
   - W panelu Resend przejdź do "Domains"
   - Dodaj swoją domenę (np. `dreamtravelsport.pl`)
   - Dodaj rekordy DNS zgodnie z instrukcjami Resend:
     - SPF record
     - DKIM record
     - DMARC record (opcjonalne, ale zalecane)
   - Po weryfikacji możesz używać dowolnych adresów z tej domeny (np. `noreply@dreamtravelsport.pl`, `kontakt@dreamtravelsport.pl`)

3. **Pobierz API Key:**
   - W panelu Resend przejdź do "API Keys"
   - Utwórz nowy klucz API
   - Skopiuj klucz

4. **Ustaw zmienne środowiskowe:**

```env
RESEND_API_KEY=re_xxxxxxxxxxxxx
RESEND_FROM_EMAIL=noreply@dreamtravelsport.pl  # Musi być z zweryfikowanej domeny
RESEND_FROM_NAME=Dream Travel Sport
# Newsletter w Resend (pod Broadcast + lista kontaktów w Resend):
# - ustaw ID listy (aud_...) LUB nazwę listy (backend sam znajdzie/utworzy Audience o tej nazwie)
RESEND_NEWSLETTER_AUDIENCE_ID=aud_xxxxxxxxxxxxx
RESEND_NEWSLETTER_AUDIENCE_NAME=Newsletter
```

**⚠️ Ograniczenia darmowego planu:**

- **3,000 emaili/miesiąc** (limit miesięczny)
- **100 emaili/dzień** (limit dzienny)
- **Weryfikacja domeny wymagana** - nie można używać darmowych domen
- **Wskaźnik odbić < 4%** - przekroczenie może skutkować wstrzymaniem
- **Wskaźnik spamu < 0.08%** - przekroczenie może skutkować wstrzymaniem

**Alternatywy dla Resend:**

- **SendGrid** (wymaga modyfikacji kodu, darmowy plan wycofany w 2024)
- **Mailgun** (wymaga modyfikacji kodu, darmowy plan: 5,000 emaili/miesiąc przez 3 miesiące)
- **AWS SES** (wymaga modyfikacji kodu, $0.10 za 1,000 emaili, weryfikacja domeny wymagana)

**Bez konfiguracji:** Aplikacja będzie działać, ale emaile nie będą wysyłane. Użytkownicy nie otrzymają:

- Potwierdzeń zamówień
- Instrukcji płatności
- Magic links do logowania
- Potwierdzeń płatności

**⚠️ Ważne:** Jeśli nie masz własnej domeny, musisz ją najpierw zakupić (np. przez Namecheap, Cloudflare, Google Domains) i skonfigurować DNS przed użyciem Resend.

---

### 4. Admin Dashboard Token 🔐

**Opis:** Token do logowania do panelu administracyjnego. Bez tego panel admina nie będzie dostępny.

**Jak wygenerować:**

1. **Wygeneruj bezpieczny token:**

```bash
# Linux/Mac
openssl rand -hex 32

# Windows (PowerShell)
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))
```

2. **Ustaw zmienną środowiskową:**

```env
ADMIN_TOKEN=twoj_wygenerowany_token_minimum_32_znaki
```

**Bez konfiguracji:** Panel administracyjny nie będzie dostępny.

---

## 📝 Przykładowy plik `.env`

Skopiuj `server/env.example` do `server/.env` i wypełnij:

```env
# Backend
PORT=3001
CORS_ORIGIN=http://localhost:5173

# Database (PostgreSQL) - WYMAGANE
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/dream_travel_sport?schema=public

# Przelewy24 (Opcjonalne)
P24_MERCHANT_ID=
P24_POS_ID=
P24_API_KEY=
P24_CRC_KEY=
P24_API_URL=https://sandbox.przelewy24.pl
P24_WEBHOOK_IPS=

# Resend (Opcjonalne)
RESEND_API_KEY=
RESEND_FROM_EMAIL=noreply@dreamtravelsport.pl
RESEND_FROM_NAME=Dream Travel Sport
RESEND_NEWSLETTER_AUDIENCE_ID=
RESEND_NEWSLETTER_AUDIENCE_NAME=

# Bank Account (Opcjonalne - dla przelewów tradycyjnych)
BANK_ACCOUNT=12 3456 7890 1234 5678 9012 3456

# Admin Dashboard (Opcjonalne)
ADMIN_TOKEN=twoj_wygenerowany_token_minimum_32_znaki
```

---

## ✅ Checklist Konfiguracji

### Minimum do uruchomienia:

- [ ] PostgreSQL skonfigurowany i działający
- [ ] `DATABASE_URL` ustawiony w `.env`
- [ ] Migracje bazy danych uruchomione (`npm run prisma:migrate`)

### Zalecane dla pełnej funkcjonalności:

- [ ] Przelewy24 skonfigurowany (płatności online)
- [ ] Resend skonfigurowany (emaile)
- [ ] Admin token wygenerowany (panel admina)
- [ ] Bank account ustawiony (dla przelewów tradycyjnych)

### Produkcja:

- [ ] PostgreSQL w chmurze (Heroku, AWS RDS, itp.)
- [ ] Przelewy24 w trybie produkcyjnym (`https://secure.przelewy24.pl`)
- [ ] Resend z zweryfikowaną domeną
- [ ] Whitelist IP dla webhooków P24
- [ ] `CORS_ORIGIN` ustawiony na domenę produkcyjną
- [ ] `ADMIN_TOKEN` wygenerowany i bezpiecznie przechowywany

---

## 🔒 Bezpieczeństwo

1. **Nigdy nie commituj pliku `.env` do repozytorium** (jest w `.gitignore`)
2. **Używaj różnych tokenów dla developmentu i produkcji**
3. **Regularnie rotuj klucze API**
4. **Używaj whitelist IP dla webhooków w produkcji**
5. **Admin token powinien być długi i losowy (minimum 32 znaki)**

---

## 💰 Analiza Darmowych Planów vs Płatnych

### Resend - Darmowy Plan (3,000 emaili/miesiąc, 100/dzień)

**Czy wystarczy?**

**⚠️ Wymagania:**

- **Własna domena wymagana** - musisz mieć własną domenę i zweryfikować ją w Resend
- **Nieograniczona liczba adresów** - możesz używać dowolnej liczby adresów z Twojej domeny
- **Nie można używać darmowych domen** (Gmail, Yahoo, Outlook)

**Szacunkowe użycie aplikacji:**

- **Potwierdzenie zamówienia:** 1 email na zamówienie
- **Instrukcje płatności:** 1 email (tylko przy przelewie tradycyjnym, ~50% zamówień)
- **Potwierdzenie płatności:** 1 email (po zapłaceniu)
- **Magic link (Dream Points):** 1 email (gdy użytkownik używa punktów, ~20% zamówień)
- **Newsletter welcome:** 1 email na zapis

**Przykładowe scenariusze:**

| Zamówienia/miesiąc | Emails na zamówienie | Newsletter | Magic Links | **RAZEM**   | Status            |
| ------------------ | -------------------- | ---------- | ----------- | ----------- | ----------------- |
| 50                 | 2.5                  | 20         | 10          | **~155**    | ✅ Wystarczy      |
| 100                | 2.5                  | 40         | 20          | **~310**    | ✅ Wystarczy      |
| 200                | 2.5                  | 80         | 40          | **~620**    | ✅ Wystarczy      |
| 500                | 2.5                  | 200        | 100         | **~1,550**  | ✅ Wystarczy      |
| 1,000              | 2.5                  | 400        | 200         | **~3,100**  | ⚠️ Blisko limitu  |
| 1,200+             | 2.5                  | 480+       | 240+        | **~3,720+** | ❌ Trzeba upgrade |

**Rekomendacja:**

- ✅ **Darmowy plan wystarczy** dla startu i pierwszych 6-12 miesięcy
- ✅ Idealny dla **do 1,000 zamówień/miesiąc**
- ⚠️ **Wymagana własna domena** - musisz ją zakupić i zweryfikować przed użyciem
- ⚠️ **Limit dzienny 100 emaili** - przy większym ruchu może być problematyczny
- ⚠️ Przy **1,000+ zamówień/miesiąc** rozważ upgrade (Plan Pro: $20/miesiąc za 50,000 emaili, bez limitu dziennego)

**Kiedy upgrade:**

- Gdy regularnie przekraczasz 2,500 emaili/miesiąc
- Gdy przekraczasz limit 100 emaili/dzień
- Gdy potrzebujesz priorytetowego wsparcia
- Gdy potrzebujesz wyższych limitów (Plan Pro: 50,000/miesiąc, bez limitu dziennego)

---

### Supabase - Darmowy Plan (500 MB bazy danych)

**⚠️ WAŻNE: Auto-Pause (Automatyczne wyłączanie)**

Supabase **automatycznie wyłącza (pause)** bazę danych na darmowym planie po **7 dniach bezczynności**. To oznacza:

- Jeśli przez tydzień nie ma żadnych zapytań do bazy, projekt zostaje wstrzymany
- Pierwsze zapytanie po wstrzymaniu może zająć **30-60 sekund** (czas na "obudzenie" bazy)
- To może być **problem dla aplikacji produkcyjnej**, gdzie użytkownicy oczekują natychmiastowej odpowiedzi

**Rozwiązania:**

1. **Keep-Alive Script (Zalecane dla produkcji):**
   - Utwórz prosty cron job, który wykonuje zapytanie do bazy co 5-6 dni
   - Możesz użyć health check endpointu lub prostego `SELECT 1`
   - Przykład z Vercel Cron, GitHub Actions, lub innego serwisu cron

2. **Upgrade do Pro ($25/miesiąc):**
   - Pro plan **nie ma auto-pause**
   - Baza jest zawsze dostępna
   - Lepsze dla aplikacji produkcyjnych

3. **Alternatywne rozwiązania:**
   - **Railway** ($5/miesiąc) - bez auto-pause
   - **Render** ($7/miesiąc) - bez auto-pause
   - **Neon** (darmowy plan z auto-pause, ale można użyć keep-alive)

**Czy wystarczy?**

**Szacunkowy rozmiar danych:**

| Tabela               | Rekordy (przykład)         | Rozmiar na rekord | Całkowity rozmiar |
| -------------------- | -------------------------- | ----------------- | ----------------- |
| Trip                 | 20                         | ~1 KB             | ~20 KB            |
| Order                | 1,200 (100/miesiąc × 12)   | ~1 KB             | ~1.2 MB           |
| OrderItem            | 1,200                      | ~200 B            | ~240 KB           |
| Passenger            | 2,400 (2 osoby/zamówienie) | ~300 B            | ~720 KB           |
| Payment              | 1,200                      | ~500 B            | ~600 KB           |
| User                 | 500                        | ~200 B            | ~100 KB           |
| NewsletterSubscriber | 1,000                      | ~200 B            | ~200 KB           |
| CheckoutSession      | 2,000 (w tym wygasłe)      | ~500 B            | ~1 MB             |
| MagicLinkToken       | 500                        | ~200 B            | ~100 KB           |
| LoyaltyAccount       | 500                        | ~200 B            | ~100 KB           |
| LoyaltyTransaction   | 2,000                      | ~300 B            | ~600 KB           |
| **RAZEM**            |                            |                   | **~4.9 MB**       |

**Przykładowe scenariusze:**

| Zamówienia/miesiąc | Okres       | Całkowite zamówienia | Szacowany rozmiar | Status           |
| ------------------ | ----------- | -------------------- | ----------------- | ---------------- |
| 50                 | 12 miesięcy | 600                  | ~2.5 MB           | ✅ Wystarczy     |
| 100                | 12 miesięcy | 1,200                | ~5 MB             | ✅ Wystarczy     |
| 200                | 12 miesięcy | 2,400                | ~10 MB            | ✅ Wystarczy     |
| 500                | 12 miesięcy | 6,000                | ~25 MB            | ✅ Wystarczy     |
| 1,000              | 12 miesięcy | 12,000               | ~50 MB            | ✅ Wystarczy     |
| 2,000              | 12 miesięcy | 24,000               | ~100 MB           | ✅ Wystarczy     |
| 5,000              | 12 miesięcy | 60,000               | ~250 MB           | ✅ Wystarczy     |
| 10,000+            | 12 miesięcy | 120,000+             | ~500 MB+          | ⚠️ Blisko limitu |

**Rekomendacja:**

- ✅ **Darmowy plan wystarczy** dla większości przypadków (rozmiar danych)
- ⚠️ **Auto-pause może być problemem** dla aplikacji produkcyjnej
- ✅ **Dla developmentu/testów:** Darmowy plan jest idealny
- ⚠️ **Dla produkcji:** Rozważ:
  - Keep-alive script (darmowe rozwiązanie)
  - Upgrade do Pro ($25/miesiąc) - bez auto-pause, zawsze dostępne
  - Alternatywne rozwiązania (Railway, Render)
- ✅ Idealny dla **do 5,000 zamówień/miesiąc** przez 12+ miesięcy (jeśli masz keep-alive)
- ⚠️ Przy **10,000+ zamówień/miesiąc** rozważ:
  - Archiwizację starych danych (zamówienia starsze niż 2 lata)
  - Upgrade do Pro ($25/miesiąc za 8 GB)

**Kiedy upgrade:**

- Gdy przekraczasz 400 MB (80% limitu)
- Gdy potrzebujesz więcej niż 2 GB storage dla plików (obrazy wyjazdów)
- Gdy potrzebujesz backupów automatycznych (darmowy plan ma tylko 7 dni)
- Gdy potrzebujesz więcej niż 2 projekty

**Optymalizacja (przed upgrade):**

- Archiwizuj stare zamówienia (starsze niż 2 lata) do osobnej tabeli
- Usuwaj wygasłe sesje checkout i magic link tokens (już zaimplementowane)
- Kompresuj obrazy przed uploadem

**Keep-Alive Script (Przykład):**

Możesz użyć prostego cron job, który wykonuje zapytanie do bazy co 5-6 dni:

```bash
# Przykład z GitHub Actions (.github/workflows/keep-alive.yml)
name: Keep Database Alive
on:
  schedule:
    - cron: '0 0 */5 * *'  # Co 5 dni
  workflow_dispatch:  # Ręczne uruchomienie
jobs:
  ping:
    runs-on: ubuntu-latest
    steps:
      - name: Ping Database
        run: |
          curl -X GET "https://twoja-domena.pl/api/health" || true
```

Lub użyj Vercel Cron, Railway Cron, lub innego serwisu.

**Alternatywne rozwiązania bez auto-pause:**

Jeśli auto-pause jest problemem, rozważ:

1. **Railway** ($5/miesiąc):
   - 5 GB bazy danych
   - Bez auto-pause
   - Zawsze dostępne
   - Proste w konfiguracji

2. **Render** ($7/miesiąc):
   - 1 GB bazy danych
   - Bez auto-pause
   - Zawsze dostępne

3. **Supabase Pro** ($25/miesiąc):
   - 8 GB bazy danych
   - Bez auto-pause
   - 100 GB storage
   - Automatyczne backupy (7 dni w darmowym, 7-30 dni w Pro)

---

## 📊 Podsumowanie Rekomendacji

### ✅ Start (0-6 miesięcy)

- **Resend Free:** Wystarczy dla do 1,000 zamówień/miesiąc (wymagana własna domena)
- **Supabase Free:** Wystarczy dla do 5,000 zamówień/miesiąc
- **Keep-Alive:** Wymagany dla produkcji (darmowy cron job)
- **Domena:** Wymagana dla Resend (~$10-15/rok)
- **Koszt:** ~$10-15/rok (tylko domena)

### ⚠️ Wzrost (6-12 miesięcy)

- **Resend Free:** Może być na granicy przy 1,000+ zamówień/miesiąc (limit 100/dzień)
- **Supabase Free:** Nadal wystarczy (z keep-alive)
- **Koszt:** $0-20/miesiąc (w zależności od emaili)
- **Alternatywa Resend:** Plan Pro ($20/miesiąc) - 50,000 emaili, bez limitu dziennego
- **Alternatywa Supabase:** Pro ($25/miesiąc) - bez auto-pause, zawsze dostępne

### 🚀 Skalowanie (12+ miesięcy)

- **Resend Pro:** $20/miesiąc (50,000 emaili)
- **Supabase Pro:** $25/miesiąc (8 GB bazy + 100 GB storage)
- **Koszt:** ~$45/miesiąc

**Wniosek:**

- Darmowe plany są **wystarczające na start i pierwszy rok** działalności
- **Auto-pause w Supabase** może być problemem dla produkcji - użyj keep-alive script lub rozważ upgrade
- Upgrade będzie potrzebny dopiero przy znacznym wzroście ruchu lub gdy potrzebujesz gwarancji dostępności 24/7

---

## 📚 Dodatkowe Zasoby

- [Dokumentacja Przelewy24](https://docs.przelewy24.pl/)
- [Dokumentacja Resend](https://resend.com/docs)
- [Dokumentacja Supabase](https://supabase.com/docs)
- [Dokumentacja Prisma](https://www.prisma.io/docs)
- [Dokumentacja PostgreSQL](https://www.postgresql.org/docs/)
