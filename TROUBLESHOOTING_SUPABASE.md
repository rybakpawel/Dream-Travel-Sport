# Rozwiązywanie problemów z połączeniem do Supabase

## Błąd: "Can't reach database server"

Jeśli widzisz błąd:
```
Error: P1001: Can't reach database server at `db.xxxxx.supabase.co:5432`
```

### Krok 1: Sprawdź format DATABASE_URL

**Poprawny format dla Supabase:**

```env
DATABASE_URL=postgresql://postgres:TWOJE_HASLO@db.xxxxx.supabase.co:5432/postgres?sslmode=require
```

**WAŻNE:**
- ✅ Musi zawierać `?sslmode=require` na końcu
- ✅ Port: `5432` (direct connection, nie 6543)
- ✅ Baza danych: `postgres` (nie zmieniaj na inną nazwę)
- ✅ Hasło: bez cudzysłowów, bez spacji

### Krok 2: Sprawdź czy plik .env istnieje

```powershell
# Windows PowerShell
Test-Path server\.env
```

Jeśli zwraca `False`, utwórz plik:

```powershell
Copy-Item server\env.example server\.env
```

### Krok 3: Sprawdź zawartość DATABASE_URL w .env

Otwórz `server\.env` i sprawdź czy `DATABASE_URL` ma poprawny format.

**Przykład poprawnego formatu:**
```env
DATABASE_URL=postgresql://postgres:TwojeSilneHaslo123!@db.zztzrzawbvjwzaxvwceo.supabase.co:5432/postgres?sslmode=require
```

**Częste błędy:**

❌ **Brak `?sslmode=require`:**
```env
DATABASE_URL=postgresql://postgres:haslo@db.xxxxx.supabase.co:5432/postgres
```

✅ **Poprawne:**
```env
DATABASE_URL=postgresql://postgres:haslo@db.xxxxx.supabase.co:5432/postgres?sslmode=require
```

❌ **Cudzysłowy wokół URL:**
```env
DATABASE_URL="postgresql://postgres:haslo@db.xxxxx.supabase.co:5432/postgres?sslmode=require"
```

✅ **Poprawne (bez cudzysłowów):**
```env
DATABASE_URL=postgresql://postgres:haslo@db.xxxxx.supabase.co:5432/postgres?sslmode=require
```

❌ **Błędny port (pooling zamiast direct):**
```env
DATABASE_URL=postgresql://postgres:haslo@db.xxxxx.supabase.co:6543/postgres?pgbouncer=true
```

✅ **Poprawne (direct connection dla migracji):**
```env
DATABASE_URL=postgresql://postgres:haslo@db.xxxxx.supabase.co:5432/postgres?sslmode=require
```

### Krok 4: Sprawdź hasło

1. Przejdź do Supabase Dashboard → Settings → Database
2. Sprawdź czy hasło w `DATABASE_URL` jest poprawne
3. Jeśli nie pamiętasz hasła, możesz je zresetować:
   - Settings → Database → Reset Database Password
   - **UWAGA:** To rozłączy wszystkie istniejące połączenia

### Krok 5: Sprawdź czy projekt Supabase jest gotowy

1. Przejdź do Supabase Dashboard
2. Sprawdź czy projekt ma zielony status "Active"
3. Jeśli status jest "Pausing" lub "Resuming", poczekaj aż będzie "Active"

### Krok 6: Sprawdź połączenie testowe

Możesz przetestować połączenie używając `psql` (jeśli masz zainstalowany PostgreSQL):

```powershell
# Windows (wymaga zainstalowanego PostgreSQL)
psql "postgresql://postgres:HASLO@db.xxxxx.supabase.co:5432/postgres?sslmode=require"
```

Lub użyj narzędzia online jak [pgAdmin](https://www.pgadmin.org/) lub [DBeaver](https://dbeaver.io/).

### Krok 7: Sprawdź firewall/antywirus

Czasami firewall lub antywirus blokuje połączenia SSL. Spróbuj:
- Tymczasowo wyłączyć antywirus/firewall
- Dodać wyjątek dla Node.js
- Sprawdzić czy port 5432 jest otwarty

## Szybkie rozwiązanie - krok po kroku

1. **Otwórz `server\.env` w edytorze tekstu**

2. **Znajdź linię `DATABASE_URL`**

3. **Upewnij się, że ma format:**
   ```
   DATABASE_URL=postgresql://postgres:HASLO@db.xxxxx.supabase.co:5432/postgres?sslmode=require
   ```

4. **Zastąp:**
   - `HASLO` - prawdziwym hasłem z Supabase
   - `xxxxx` - ID Twojego projektu Supabase
   - Upewnij się, że na końcu jest `?sslmode=require`

5. **Zapisz plik**

6. **Spróbuj ponownie:**
   ```powershell
   npm run prisma:migrate:deploy
   ```

## Przykład poprawnego .env

```env
# Backend
PORT=3001
CORS_ORIGIN=http://localhost:5173
SERVER_PUBLIC_URL=http://localhost:3001

# Database (Supabase)
DATABASE_URL=postgresql://postgres:TwojeSilneHaslo123!@db.zztzrzawbvjwzaxvwceo.supabase.co:5432/postgres?sslmode=require

# Reszta zmiennych...
```

## Jeśli nadal nie działa

1. **Sprawdź logi Prisma:**
   ```powershell
   npm run prisma:migrate:deploy -- --verbose
   ```

2. **Sprawdź czy Supabase jest dostępne:**
   - Otwórz przeglądarkę i przejdź do Supabase Dashboard
   - Sprawdź czy możesz zobaczyć tabele (Table Editor)

3. **Sprawdź czy projekt nie jest w trybie "Paused":**
   - Free tier może "zasypiać" po okresie nieaktywności
   - Kliknij "Resume" jeśli projekt jest wstrzymany

4. **Spróbuj użyć connection pooling (port 6543):**
   ```env
   DATABASE_URL=postgresql://postgres:HASLO@db.xxxxx.supabase.co:6543/postgres?pgbouncer=true
   ```
   **UWAGA:** Connection pooling może nie działać z migracjami Prisma - używaj tylko dla aplikacji, nie dla migracji.

