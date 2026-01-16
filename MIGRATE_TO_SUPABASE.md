# Migracja bazy danych do Supabase

## Rozumienie problemu

### Różnica między migracjami a danymi

**Migracje Prisma:**

- Tworzą **strukturę** bazy danych (tabele, kolumny, indeksy, relacje)
- NIE przenoszą danych
- Uruchamiane przez `prisma migrate deploy`

**Dane:**

- To zawartość tabel (rekordy)
- Muszą być przeniesione osobno (pg_dump/pg_restore)
- Migracje tylko przygotowują "szkielet" bazy

### Twój problem: Failed Migration

Błąd P3009 oznacza, że migracja `20250115000000_add_loyalty_transaction_expires_at` rozpoczęła się w Supabase, ale się nie zakończyła (failed migration).

## Rozwiązanie: Opcje naprawy

### Opcja 1: Resolve Failed Migration (jeśli baza ma już część struktury)

Jeśli w Supabase jest już część tabel, możesz oznaczyć migrację jako zastosowaną:

```powershell
# Sprawdź status migracji
dotenv -e server/.env -- prisma migrate status --schema=server/prisma/schema.prisma

# Oznacz failed migration jako zastosowaną (jeśli struktura już istnieje)
dotenv -e server/.env -- prisma migrate resolve --applied 20250115000000_add_loyalty_transaction_expires_at --schema=server/prisma/schema.prisma

# Potem uruchom ponownie deploy
npm run prisma:migrate:deploy
```

**UWAGA:** Używaj tego tylko jeśli jesteś pewien, że struktura z tej migracji już istnieje w bazie!

### Opcja 2: Reset bazy (zalecane dla świeżego setupu) ⭐

Jeśli baza Supabase jest pusta lub nie zawiera ważnych danych, najprościej jest ją zresetować:

#### 2.1. Reset przez Supabase Dashboard

1. Supabase Dashboard → Twoj projekt → **Settings** → **Database**
2. Przewiń do sekcji **Danger Zone**
3. Kliknij **"Reset Database"** lub **"Pause project"** → **"Delete project"** → utwórz nowy

**UWAGA:** To usunie WSZYSTKIE dane w bazie!

#### 2.2. Reset przez SQL (alternatywa)

Możesz też połączyć się z bazą i usunąć tabelę `_prisma_migrations`:

1. Supabase Dashboard → **SQL Editor**
2. Wykonaj:

```sql
-- Usuń tabelę z historią migracji
DROP TABLE IF EXISTS "_prisma_migrations" CASCADE;

-- Opcjonalnie: usuń wszystkie tabele (jeśli chcesz zacząć od zera)
-- UWAGA: To usunie wszystkie dane!
-- DROP SCHEMA public CASCADE;
-- CREATE SCHEMA public;
-- GRANT ALL ON SCHEMA public TO postgres;
-- GRANT ALL ON SCHEMA public TO public;
```

3. Potem uruchom migracje od nowa:

```powershell
npm run prisma:migrate:deploy
```

### Opcja 3: Ręczne naprawienie (dla zaawansowanych)

Jeśli wiesz dokładnie co poszło nie tak:

1. Sprawdź co robiła failed migration - otwórz plik:
   `server/prisma/migrations/20250115000000_add_loyalty_transaction_expires_at/migration.sql`

2. Wykonaj ręcznie brakujące komendy SQL przez Supabase SQL Editor

3. Oznacz migrację jako zastosowaną (Opcja 1)

---

## Przenoszenie danych z lokalnej bazy do Supabase

**WAŻNE:** Migracje przenoszą tylko strukturę. Dane musisz przenieść osobno!

### Krok 1: Backup danych z lokalnej bazy

#### Jeśli używasz Docker (npm run db:up):

```powershell
# Sprawdź nazwę kontenera
docker ps

# Zrób backup (zamień 'nazwa_kontenera' na rzeczywistą nazwę)
docker exec -t nazwa_kontenera pg_dump -U postgres dream_travel_sport > backup_local.sql
```

#### Jeśli używasz lokalnego PostgreSQL:

```powershell
# Windows (wymaga zainstalowanego PostgreSQL)
pg_dump -U postgres -d dream_travel_sport > backup_local.sql

# Jeśli nie masz pg_dump, użyj Prisma Studio do eksportu danych ręcznie
npm run prisma:studio
```

### Krok 2: Przygotowanie Supabase

Upewnij się, że struktura bazy w Supabase jest aktualna:

```powershell
# Uruchom migracje na Supabase (jeśli jeszcze nie)
npm run prisma:migrate:deploy
```

### Krok 3: Import danych do Supabase

#### Metoda 1: Przez Supabase Dashboard (dla małych ilości danych)

1. Supabase Dashboard → **Table Editor**
2. Dla każdej tabeli:
   - Otwórz tabelę
   - Kliknij **"Insert row"**
   - Wypełnij dane ręcznie

**To działa tylko dla małych ilości danych!**

#### Metoda 2: Przez SQL Editor (dla większych ilości)

1. Otwórz `backup_local.sql` w edytorze tekstu
2. Wyczyść plik:
   - Usuń komendy `CREATE TABLE` (struktura już istnieje)
   - Zostaw tylko `INSERT INTO` i dane
   - Usuń `CREATE INDEX` jeśli indeksy już istnieją
3. Supabase Dashboard → **SQL Editor**
4. Wklej i wykonaj oczyszczony SQL

#### Metoda 3: Przez psql (najlepsze dla dużych baz)

```powershell
# Windows (wymaga zainstalowanego PostgreSQL)
# Najpierw wyczyść backup - usuń komendy CREATE TABLE, zostaw tylko INSERT
# Potem:
psql "postgresql://postgres:HASLO@db.xxxxx.supabase.co:5432/postgres?sslmode=require" < backup_local.sql
```

**UWAGA:** Backup z `pg_dump` zawiera komendy `CREATE TABLE` - musisz je usunąć lub użyć flagi `--data-only`:

```powershell
# Backup tylko danych (bez struktury)
docker exec -t nazwa_kontenera pg_dump -U postgres --data-only dream_travel_sport > backup_data_only.sql

# Potem import:
psql "postgresql://postgres:HASLO@db.xxxxx.supabase.co:5432/postgres?sslmode=require" < backup_data_only.sql
```

#### Metoda 4: Przez Prisma Studio (dla małych ilości danych)

1. Podłącz Prisma Studio do lokalnej bazy
2. Podłącz Prisma Studio do Supabase
3. Ręcznie skopiuj dane między bazami

---

## Rekomendowany proces dla świeżego setupu

### Scenariusz: Masz lokalną bazę z danymi i chcesz przenieść do Supabase

1. **Przygotuj Supabase:**

   ```powershell
   # Upewnij się, że DATABASE_URL w server/.env wskazuje na Supabase
   # Reset bazy jeśli potrzeba (Opcja 2 powyżej)
   ```

2. **Uruchom migracje na Supabase:**

   ```powershell
   npm run prisma:migrate:deploy
   ```

3. **Backup danych z lokalnej bazy:**

   ```powershell
   # Tylko dane (bez struktury)
   docker exec -t nazwa_kontenera pg_dump -U postgres --data-only dream_travel_sport > backup_data.sql
   ```

4. **Import danych do Supabase:**

   ```powershell
   # Przez psql (jeśli masz zainstalowany PostgreSQL)
   psql "postgresql://postgres:HASLO@db.xxxxx.supabase.co:5432/postgres?sslmode=require" < backup_data.sql
   ```

5. **Weryfikacja:**
   - Supabase Dashboard → Table Editor
   - Sprawdź czy dane są w tabelach
   - Lub użyj `npm run prisma:studio` (zmień DATABASE_URL w .env)

---

## FAQ

### Czy migracje przenoszą dane?

**NIE.** Migracje przenoszą tylko strukturę (tabele, kolumny, indeksy). Dane musisz przenieść osobno.

### Kiedy używać `prisma migrate deploy` vs `prisma migrate dev`?

- **`prisma migrate deploy`** - dla produkcji (Supabase, Render, itp.)
- **`prisma migrate dev`** - dla developmentu (lokalna baza)

### Czy mogę użyć `prisma db push` zamiast migracji?

`prisma db push` synchronizuje schema bezpośrednio, omijając migracje.

- **Nie używaj** w produkcji - nie tworzy historii migracji
- **Używaj tylko** dla szybkich testów lokalnie

### Jak sprawdzić status migracji?

```powershell
dotenv -e server/.env -- prisma migrate status --schema=server/prisma/schema.prisma
```

### Czy mogę anulować failed migration?

Tak - użyj `prisma migrate resolve`:

```powershell
# Oznacz jako zastosowaną (jeśli struktura już istnieje)
dotenv -e server/.env -- prisma migrate resolve --applied NAZWA_MIGRACJI --schema=server/prisma/schema.prisma

# Oznacz jako wycofaną (jeśli chcesz ją pominąć)
dotenv -e server/.env -- prisma migrate resolve --rolled-back NAZWA_MIGRACJI --schema=server/prisma/schema.prisma
```

---

## Podsumowanie - co zrobić teraz?

### Jeśli baza Supabase jest pusta (bez ważnych danych):

1. **Reset bazy** (Opcja 2)
2. **Uruchom migracje:**
   ```powershell
   npm run prisma:migrate:deploy
   ```
3. **Przenieś dane** (jeśli potrzebujesz)

### Jeśli baza Supabase ma już dane:

1. **Sprawdź status:**
   ```powershell
   dotenv -e server/.env -- prisma migrate status --schema=server/prisma/schema.prisma
   ```
2. **Napraw failed migration** (Opcja 1 lub 3)
3. **Kontynuuj deployment**
