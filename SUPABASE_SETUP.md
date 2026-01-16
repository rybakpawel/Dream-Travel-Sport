# Konfiguracja Supabase - Kompletny przewodnik

Ten dokument opisuje jak skonfigurować bazę danych Supabase dla aplikacji Dream Travel Sports.

## Czym jest Supabase?

Supabase to open-source alternatywa dla Firebase, oferująca:
- **PostgreSQL** jako bazę danych
- Darmowy tier (500MB bazy, 2GB transferu)
- Wbudowany dashboard do zarządzania
- Automatyczne backupy
- HTTPS/SSL out of the box
- Connection pooling

## Krok 1: Utworzenie konta i projektu

### 1.1. Rejestracja

1. Przejdź na [supabase.com](https://supabase.com)
2. Kliknij **"Start your project"** lub **"Sign in"**
3. Zaloguj się przez GitHub (zalecane) lub email
4. Zaakceptuj warunki użytkowania

### 1.2. Utworzenie projektu

1. W Dashboard kliknij **"New Project"** (zielony przycisk)
2. Wypełnij formularz:

   **Basic Information:**
   - **Name:** `dream-travel-sports` (lub dowolna nazwa)
   - **Database Password:** 
     - Wygeneruj silne hasło (minimum 12 znaków)
     - **WAŻNE:** Zapisz to hasło! Będziesz go potrzebował do `DATABASE_URL`
     - Możesz użyć generatora haseł (np. 1Password, LastPass, lub wbudowanego w przeglądarce)
     - Przykład bezpiecznego hasła: `A7x9$mK2#pL5!nQ8`

   **Region:**
   - Wybierz region najbliższy Twoim użytkownikom
   - Dla Polski: **West Europe** (Belgia) lub **Central EU** (Frankfurt)
   - Zazwyczaj najbliższy region = szybsze połączenia

   **Pricing Plan:**
   - **Free:** 500MB bazy, 2GB transferu/mies, 500MB plików
   - Dla małych/średnich aplikacji darmowy tier wystarcza
   - Możesz upgradować później jeśli potrzeba

3. Kliknij **"Create new project"**
4. Poczekaj 2-3 minuty aż projekt się utworzy

### 1.3. Weryfikacja utworzenia projektu

Po utworzeniu zobaczysz:
- ✅ Zielony status "Project is ready"
- Dashboard z podstawowymi informacjami
- Link do bazy danych

---

## Krok 2: Uzyskanie DATABASE_URL

`DATABASE_URL` to connection string potrzebny do połączenia z bazą danych przez Prisma.

### 2.1. Przejście do ustawień bazy danych

1. W Supabase Dashboard (lewy panel) kliknij **"Settings"** (ikonka koła zębatego)
2. Wybierz **"Database"** z menu Settings
3. Przewiń do sekcji **"Connection string"**

### 2.2. Wybór typu połączenia

Supabase oferuje kilka opcji:

**URI (Connection Pooling)** - zalecane dla większości aplikacji:
- Używa PgBouncer do connection pooling
- Lepsze dla aplikacji z wieloma równoczesnymi połączeniami
- Port: **6543**

**URI (Direct connection)** - dla migracji i operacji administracyjnych:
- Bezpośrednie połączenie z bazą
- Lepsze dla migracji Prisma
- Port: **5432**

**Session mode** - nie używamy (dla innych narzędzi)

### 2.3. Kopiowanie connection string

**Dla aplikacji (production):**

Wybierz **"URI"** (Connection Pooling) i skopiuj connection string:

```
postgresql://postgres:[YOUR-PASSWORD]@db.xxxxx.supabase.co:6543/postgres?pgbouncer=true
```

**WAŻNE:** Zamień `[YOUR-PASSWORD]` na hasło które ustawiłeś przy tworzeniu projektu!

**Pełny przykład:**
```
postgresql://postgres:A7x9$mK2#pL5!nQ8@db.abcdefghijklmnop.supabase.co:6543/postgres?pgbouncer=true
```

**Dla migracji Prisma:**

Wybierz **"URI"** (Direct connection) i skopiuj:

```
postgresql://postgres:[YOUR-PASSWORD]@db.xxxxx.supabase.co:5432/postgres
```

Zamień `[YOUR-PASSWORD]` i dodaj `?sslmode=require`:

```
postgresql://postgres:A7x9$mK2#pL5!nQ8@db.abcdefghijklmnop.supabase.co:5432/postgres?sslmode=require
```

### 2.4. Zalecany format dla Dream Travel Sports

**Dla aplikacji (w zmiennych środowiskowych):**

Używamy direct connection z SSL:

```env
DATABASE_URL=postgresql://postgres:TWOJE_HASLO@db.xxxxx.supabase.co:5432/postgres?sslmode=require
```

**Dlaczego direct connection zamiast pgbouncer?**
- Prisma używa prepared statements, które nie działają dobrze z PgBouncer w transaction mode
- Direct connection jest prostszy i działa bez problemów
- Dla małych/średnich aplikacji różnica w wydajności jest minimalna

**Dla większych aplikacji** możesz użyć connection poolingu, ale wymaga to dodatkowej konfiguracji Prisma.

### 2.5. Zapisywanie DATABASE_URL

Zapisz `DATABASE_URL` w bezpiecznym miejscu:
- ✅ Notatnik (ale nie commitnij do Git!)
- ✅ Password manager (1Password, LastPass)
- ✅ Zmienne środowiskowe w Render/Railway (następny krok)

**NIGDY nie commitnij hasła do Git!**

---

## Krok 3: Konfiguracja lokalna (opcjonalnie - test przed deployment)

Możesz przetestować połączenie z Supabase lokalnie przed wdrożeniem na Render.

### 3.1. Przygotowanie pliku .env

1. Skopiuj przykładowy plik:

```bash
# W katalogu głównym projektu
cp server/env.example server/.env
```

2. Edytuj `server/.env`:

```bash
# Windows
notepad server/.env

# Linux/Mac
nano server/.env
```

3. Ustaw `DATABASE_URL` na URL z Supabase:

```env
DATABASE_URL=postgresql://postgres:TWOJE_HASLO@db.xxxxx.supabase.co:5432/postgres?sslmode=require
```

Zamień `TWOJE_HASLO` na rzeczywiste hasło i `xxxxx` na ID Twojego projektu.

### 3.2. Generowanie Prisma Client

```bash
npm run prisma:generate
```

To wygeneruje Prisma Client na podstawie `server/prisma/schema.prisma`.

### 3.3. Uruchomienie migracji

```bash
npm run prisma:migrate:deploy
```

To zastosuje wszystkie migracje z `server/prisma/migrations/` do bazy Supabase.

**Co się dzieje:**
- Prisma czyta wszystkie migracje SQL z `migrations/`
- Wykonuje je w bazie Supabase
- Tworzy wszystkie tabele, indeksy, itd.

### 3.4. Weryfikacja połączenia

Uruchom backend lokalnie:

```bash
npm run dev:server
```

Sprawdź health endpoint:

```bash
# W innym terminalu
curl http://localhost:3001/api/health
```

Powinno zwrócić: `{"status":"ok"}`

Jeśli wszystko działa, możesz przejść do deploymentu na Render!

---

## Krok 4: Konfiguracja w Supabase Dashboard

### 4.1. Przegląd struktury bazy danych

Po uruchomieniu migracji możesz zobaczyć strukturę bazy w Supabase:

1. Supabase Dashboard → **"Table Editor"** (lewy panel)
2. Zobaczysz wszystkie tabele utworzone przez migracje:
   - `Trip`
   - `Order`
   - `User`
   - `LoyaltyTransaction`
   - itd.

### 4.2. (Opcjonalnie) Dodanie danych testowych

Możesz dodać dane testowe przez Table Editor:

1. Kliknij na tabelę (np. `Trip`)
2. Kliknij **"Insert row"**
3. Wypełnij pola
4. Kliknij **"Save"**

**Lub** użyj Prisma Studio:

```bash
npm run prisma:studio
```

Otworzy się przeglądarka z GUI do zarządzania danymi.

### 4.3. Przegląd logów

1. Supabase Dashboard → **"Logs"** (lewy panel)
2. Możesz zobaczyć:
   - **API Logs** - requesty do API (jeśli używasz Supabase API)
   - **Postgres Logs** - logi bazy danych
   - **Auth Logs** - logi autentykacji (jeśli używasz)

**Dla naszej aplikacji:** Używamy tylko PostgreSQL, więc interesują nas głównie Postgres Logs.

### 4.4. Ustawienia bezpieczeństwa

1. Supabase Dashboard → **"Settings"** → **"Database"**

**Connection Pooling:**
- Domyślnie włączone
- Dla małych aplikacji możesz zostawić domyślne ustawienia

**SSL Enforcement:**
- **Zawsze włączone** dla Supabase
- To dlatego dodajemy `?sslmode=require` do DATABASE_URL

**Database Password:**
- Możesz zmienić hasło jeśli chcesz
- Jeśli zmieniasz, zaktualizuj `DATABASE_URL` wszędzie gdzie go używasz

---

## Krok 5: Backup i restore

### 5.1. Automatyczne backupy

Supabase automatycznie wykonuje backupy:
- **Free tier:** Daily backups (przechowywane 7 dni)
- **Pro tier:** Point-in-time recovery

Nie musisz nic konfigurować - backupy dzieją się automatycznie.

### 5.2. Ręczny backup przez Supabase Dashboard

1. Supabase Dashboard → **"Settings"** → **"Database"**
2. Przewiń do **"Database backups"**
3. Kliknij **"Download backup"** (jeśli dostępne)
4. Pobierz plik `.sql` z backupem

### 5.3. Ręczny backup przez pg_dump

Z poziomu terminala:

```bash
# Backup
pg_dump "postgresql://postgres:HASLO@db.xxxxx.supabase.co:5432/postgres?sslmode=require" > backup.sql

# Restore
psql "postgresql://postgres:HASLO@db.xxxxx.supabase.co:5432/postgres?sslmode=require" < backup.sql
```

**Uwaga:** Na Windows może być potrzebny `pg_dump.exe` z instalacji PostgreSQL.

---

## Krok 6: Monitorowanie i limity

### 6.1. Przegląd użycia

1. Supabase Dashboard → **"Settings"** → **"Usage"**

Zobaczysz:
- **Database Size** - ile miejsca używasz (limit: 500MB na free tier)
- **Database Egress** - transfer danych (limit: 2GB/mies na free tier)
- **API Requests** - jeśli używasz Supabase API

### 6.2. Limity free tier

| Zasób | Limit (Free) | Limit (Pro) |
|-------|--------------|-------------|
| Database Size | 500MB | 8GB |
| Database Egress | 2GB/mies | 50GB/mies |
| File Storage | 1GB | 100GB |
| Bandwidth | 5GB/mies | 200GB/mies |

**Dla małych/średnich aplikacji:** Free tier zazwyczaj wystarcza.

### 6.3. Upgrade do Pro

Jeśli przekroczysz limity:

1. Supabase Dashboard → **"Settings"** → **"Billing"**
2. Kliknij **"Upgrade to Pro"**
3. Wybierz plan (od $25/mies)
4. Większe limity i więcej funkcji

---

## Krok 7: Integracja z Render

Po skonfigurowaniu Supabase, użyj `DATABASE_URL` w Render:

1. Render Dashboard → Twój Web Service → **"Environment"**
2. Dodaj zmienną środowiskową:
   - **Key:** `DATABASE_URL`
   - **Value:** `postgresql://postgres:HASLO@db.xxxxx.supabase.co:5432/postgres?sslmode=require`
3. Kliknij **"Save Changes"**
4. Render automatycznie użyje tego URL do połączenia z bazą

Zobacz `DEPLOY_RENDER_SUPABASE.md` dla pełnej instrukcji deploymentu.

---

## Rozwiązywanie problemów

### Problem: "Connection refused" lub "timeout"

**Rozwiązanie:**
- Sprawdź czy `DATABASE_URL` jest poprawny
- Upewnij się, że hasło jest poprawne (bez cudzysłowów)
- Sprawdź czy region Supabase jest dostępny
- Spróbuj użyć direct connection (`:5432`) zamiast pooling (`:6543`)

### Problem: "SSL connection required"

**Rozwiązanie:**
- Dodaj `?sslmode=require` do końca `DATABASE_URL`
- Supabase wymaga SSL dla wszystkich połączeń

### Problem: "Password authentication failed"

**Rozwiązanie:**
- Sprawdź czy hasło w `DATABASE_URL` jest poprawne
- Upewnij się, że nie ma spacji lub znaków specjalnych które mogą być źle zinterpretowane
- Możesz zresetować hasło: Settings → Database → Reset Database Password

### Problem: "Database does not exist"

**Rozwiązanie:**
- Sprawdź czy nazwa bazy w `DATABASE_URL` to `postgres` (domyślna dla Supabase)
- Upewnij się, że projekt Supabase jest w pełni utworzony (zielony status)

### Problem: Migracje się nie wykonują

**Rozwiązanie:**
- Upewnij się, że używasz direct connection (`:5432`) dla migracji
- Sprawdź logi Prisma: `npm run prisma:migrate:deploy -- --verbose`
- Sprawdź czy migracje są w `server/prisma/migrations/`

### Problem: Przekroczenie limitu bazy danych

**Rozwiązanie:**
- Sprawdź użycie: Settings → Usage
- Usuń niepotrzebne dane
- Rozważ upgrade do Pro tier
- Zoptymalizuj strukturę bazy (usuwanie starych rekordów, archiwizacja)

---

## Najlepsze praktyki

### Bezpieczeństwo

- ✅ **NIGDY nie commitnij** `DATABASE_URL` z hasłem do Git
- ✅ Używaj zmiennych środowiskowych dla `DATABASE_URL`
- ✅ Regularnie zmieniaj hasło bazy danych (co 3-6 miesięcy)
- ✅ Używaj silnego hasła (minimum 12 znaków, mix znaków specjalnych)

### Wydajność

- ✅ Używaj indeksów dla często wyszukiwanych kolumn (Prisma robi to automatycznie)
- ✅ Regularnie czyszcz starych danych (np. wygasłe sesje checkout)
- ✅ Monitoruj użycie bazy (Settings → Usage)
- ✅ Dla większych aplikacji rozważ connection pooling

### Backup

- ✅ Supabase wykonuje automatyczne backupy (free tier: 7 dni)
- ✅ Dla krytycznych danych rozważ ręczne backupy
- ✅ Przetestuj restore proces przed potrzebą użycia backupu

### Migracje

- ✅ Zawsze testuj migracje lokalnie przed deploymentem
- ✅ Używaj `prisma:migrate:deploy` dla produkcji (nie `prisma:migrate dev`)
- ✅ Sprawdź logi po migracjach
- ✅ Rozważ backup przed większymi migracjami

---

## Podsumowanie - co masz teraz?

Po przejściu przez ten przewodnik:

1. ✅ Projekt Supabase utworzony
2. ✅ `DATABASE_URL` skonfigurowany
3. ✅ Migracje wykonane (tabele utworzone)
4. ✅ Połączenie przetestowane (opcjonalnie lokalnie)
5. ✅ Gotowe do użycia w Render

**Następny krok:** Zobacz `DEPLOY_RENDER_SUPABASE.md` dla instrukcji deploymentu na Render.

---

## Przydatne linki

- [Supabase Documentation](https://supabase.com/docs)
- [Supabase Dashboard](https://app.supabase.com)
- [Prisma Documentation](https://www.prisma.io/docs)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)

