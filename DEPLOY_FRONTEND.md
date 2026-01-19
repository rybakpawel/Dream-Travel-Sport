# Wdrożenie frontendu w Cyberfolks

Ten dokument opisuje jak wdrożyć frontend aplikacji Dream Travel Sports na hostingu Cyberfolks.

## Wymagania wstępne

- Node.js 18+ zainstalowany lokalnie (do zbudowania aplikacji)
- Dostęp FTP/SFTP do hostingu Cyberfolks
- Znajomość ścieżki do katalogu `public_html` lub `www` na hostingu

## Krok 1: Zbudowanie aplikacji

### Opcja A: Backend będzie na innym URL (zalecane dla produkcji)

Jeśli backend API będzie działał na innym URL niż `http://localhost:3001/api`, musisz zbudować aplikację z odpowiednią zmienną środowiskową:

**Windows (PowerShell):**

```powershell
$env:VITE_API_URL="https://twoja-domena.pl/api"; npm run build
```

**Linux/Mac:**

```bash
VITE_API_URL="https://twoja-domena.pl/api" npm run build
```

**Uwaga:** Zamień `https://twoja-domena.pl/api` na rzeczywisty URL Twojego API backend.

### Opcja B: Backend będzie na localhost (tylko do testów)

Jeśli backend nie jest jeszcze wdrożony, możesz zbudować z domyślnym URL:

```bash
npm run build
```

**Uwaga:** Jeśli zbudujesz z domyślnym URL (`http://localhost:3001/api`), frontend nie będzie mógł komunikować się z backendem na produkcji. Musisz później przebudować aplikację z poprawnym URL API.

## Krok 2: Sprawdzenie wyniku builda

Po zbudowaniu, katalog `dist/` powinien zawierać:

- Pliki HTML (index.html, koszyk.html, platnosc.html, etc.)
- Katalog `assets/` z zbudowanymi plikami CSS i JavaScript
- Katalog `public/` z zasobami statycznymi (obrazy, fonty, PDF, etc.)

Sprawdź strukturę:

```bash
# Windows
dir dist

# Linux/Mac
ls -la dist/
```

### FAQ: Czy katalog `src/` trzeba przesyłać?

**NIE!** Katalog `src/` NIE trzeba przesyłać na hosting. Vite kompiluje wszystko podczas builda:

- TypeScript z `web/src/` → JavaScript w `dist/assets/`
- CSS z `web/src/styles/` → CSS w `dist/assets/`
- Vite aktualizuje ścieżki w HTML z `src/...` na `assets/...`

**Na produkcji potrzebujesz tylko `dist/`** - wszystkie pliki są już zbudowane i gotowe. Katalog `src/` to tylko kod źródłowy dla developmentu.

### FAQ: Wspólny package.json - czy to problem?

**Nie, to jest w porządku!** To jest struktura monorepo (jeden package.json dla całego projektu):

- Zależności backendowe (express, prisma, etc.) są potrzebne tylko do budowania i uruchamiania backendu
- Zależności frontendowe (vite) są potrzebne tylko do budowania frontendu
- **W katalogu `dist/` są tylko statyczne pliki** (HTML, CSS, JS) - żadnych zależności Node.js, żadnych `node_modules`
- Na hostingu statycznym (Cyberfolks) nie potrzebujesz Node.js ani package.json - tylko pliki z `dist/`

### FAQ: Czy frontend używa bibliotek z package.json?

**Aktualnie NIE** - Twój frontend nie używa żadnych zewnętrznych bibliotek npm. Wszystkie importy w kodzie to lokalne pliki z `web/src/` (np. `import { tripsApi } from "../api/client.js"`).

**Co jeśli dodasz bibliotekę frontendową (np. lodash, date-fns, axios)?**

1. **Dodajesz do package.json:**

   ```bash
   npm install lodash
   npm install --save-dev @types/lodash  # dla TypeScript
   ```

2. **Używasz w kodzie:**

   ```typescript
   import _ from "lodash"; // w pliku web/src/...
   ```

3. **Vite automatycznie bundluje:**
   - Podczas `npm run build` Vite automatycznie dołącza bibliotekę do zbudowanych plików
   - Kod biblioteki jest bundlowany do `dist/assets/` razem z Twoim kodem
   - Wszystko jest w jednym (lub kilku) pliku JavaScript

4. **Na produkcji nadal potrzebujesz tylko `dist/`:**
   - **NIE** potrzebujesz `node_modules` na serwerze
   - **NIE** potrzebujesz `package.json` na serwerze
   - Wszystko jest już zbudowane w `dist/assets/` - gotowe pliki JS/CSS

**Przykład:**

- Development: `npm install lodash` → kod w `node_modules/lodash/`
- Build: `npm run build` → Vite bundluje lodash do `dist/assets/index-xyz123.js`
- Produkcja: Przesyłasz tylko `dist/` → wszystko działa, lodash jest w zbudowanym pliku

## Krok 3: Przesłanie plików na Cyberfolks

### Metoda 1: FTP/SFTP (FileZilla, WinSCP, itp.)

1. Połącz się z serwerem Cyberfolks przez FTP/SFTP
2. Przejdź do katalogu głównego domeny (zwykle `public_html` lub `www`)
3. **UWAGA:** Jeśli w katalogu są już jakieś pliki, zrób backup przed kontynuowaniem!
4. Prześlij **całą zawartość** katalogu `dist/` do `public_html/` (lub `www/`)

   **WAŻNE:** Prześlij zawartość katalogu `dist/`, nie sam katalog `dist/`!

   Przykład struktury po przesłaniu:

   ```
   public_html/
     ├── .htaccess          ← WAŻNE: Ten plik musi być przesłany!
     ├── index.html
     ├── koszyk.html
     ├── platnosc.html
     ├── assets/
     └── public/
   ```

   **Uwaga:** Plik `.htaccess` jest automatycznie kopiowany do `dist/` podczas buildu. Upewnij się, że został przesłany na serwer (zwykle jest ukryty, włącz pokazywanie ukrytych plików w kliencie FTP).

### Metoda 2: Panel Cyberfolks (File Manager)

1. Zaloguj się do panelu Cyberfolks
2. Otwórz File Manager
3. Przejdź do katalogu `public_html` lub `www`
4. Prześlij pliki z katalogu `dist/` (możesz użyć funkcji "Upload" i wybrać wszystkie pliki z `dist/`)

## Krok 4: Sprawdzenie uprawnień plików

Upewnij się, że pliki mają odpowiednie uprawnienia:

- Pliki HTML, CSS, JS: `644` (rw-r--r--)
- Katalogi: `755` (rwxr-xr-x)

W File Managerze Cyberfolks zwykle można ustawić uprawnienia przez menu kontekstowe.

## Krok 5: Weryfikacja

1. Otwórz przeglądarkę i przejdź na swoją domenę
2. Sprawdź czy strona główna się ładuje
3. Sprawdź konsolę przeglądarki (F12 → Console) czy nie ma błędów
4. Sprawdź czy linki do podstron działają

## Rozwiązywanie problemów

### Problem: Strona się nie ładuje / 404

- Sprawdź czy plik `index.html` jest w katalogu głównym (`public_html/`)
- Sprawdź uprawnienia plików (powinny być `644` dla plików)
- Sprawdź czy ścieżki do zasobów są poprawne (otwórz DevTools → Network)

### Problem: Błędy 404 dla plików CSS/JS

- Sprawdź czy katalog `assets/` został przesłany
- Sprawdź czy ścieżki w HTML są poprawne (powinny zaczynać się od `./assets/`)

### Problem: API zwraca błędy CORS lub nie działa

- Sprawdź czy zbudowałeś aplikację z poprawnym URL API (`VITE_API_URL`)
- Sprawdź czy backend API jest dostępny i działa
- Sprawdź konfigurację CORS na backendzie (musi pozwalać na Twoją domenę)

### Problem: Obrazy się nie ładują

- Sprawdź czy katalog `public/` został przesłany
- Sprawdź uprawnienia katalogu `public/` (powinien być `755`)
- Sprawdź czy ścieżki w kodzie są poprawne

## Przebudowanie po zmianach

Jeśli wprowadzisz zmiany w kodzie frontendu:

1. Wprowadź zmiany w kodzie
2. Zbuduj ponownie: `npm run build` (lub z `VITE_API_URL` jeśli potrzebne)
3. Prześlij zmienione pliki na serwer (lub cały katalog `dist/`)

**Wskazówka:** Jeśli używasz FTP, możesz przesłać tylko zmienione pliki (zwykle w katalogu `assets/`) zamiast całego katalogu.

## Krok 6: Konfiguracja nagłówków Cache-Control (WAŻNE!)

Aby zapobiec problemom z cache'owaniem starych treści, musisz skonfigurować nagłówki Cache-Control na serwerze.

### Opcja A: Używając pliku .htaccess (zalecane dla Cyberfolks/Apache)

1. **Utwórz plik `.htaccess`** w katalogu głównym projektu (`web/.htaccess`) - plik został już utworzony w projekcie
2. **Prześlij plik `.htaccess`** razem z innymi plikami na serwer (do `public_html/` lub `www/`)
3. Plik automatycznie ustawi odpowiednie nagłówki cache:
   - HTML: `no-cache` (zawsze pobieraj świeże)
   - JS/CSS/obrazy z hashem: `max-age=1 rok` (można cache'ować długo, bo nazwy się zmieniają)
   - PDF: `max-age=1 godzina` (może być aktualizowany)

**Uwaga:** Upewnij się, że moduł `mod_headers` jest włączony na serwerze (zwykle jest domyślnie w Cyberfolks). Jeśli nagłówki nie działają, skontaktuj się z supportem Cyberfolks.

### Opcja B: Przez Panel Cyberfolks (jeśli .htaccess nie działa)

Jeśli plik `.htaccess` nie działa, możesz skonfigurować nagłówki przez panel Cyberfolks:

1. Zaloguj się do panelu Cyberfolks
2. Przejdź do sekcji "Apache" lub "Headers"
3. Dodaj reguły dla:
   - Plików HTML: `Cache-Control: no-cache, no-store, must-revalidate`
   - Plików JS/CSS z hashem: `Cache-Control: public, max-age=31536000, immutable`

### Weryfikacja

Aby sprawdzić czy nagłówki działają:

1. Otwórz DevTools w przeglądarce (F12)
2. Przejdź do zakładki "Network"
3. Odśwież stronę (F5)
4. Kliknij na `index.html` w liście requestów
5. Sprawdź zakładkę "Headers"
6. Szukaj sekcji "Response Headers" - powinieneś zobaczyć `Cache-Control: no-cache, no-store, must-revalidate`

Jeśli nie widzisz tych nagłówków, moduł `mod_headers` może nie być włączony - skontaktuj się z supportem Cyberfolks.

## Ważne uwagi

1. **Backend URL:** Jeśli backend nie działa jeszcze na produkcji, frontend będzie próbował łączyć się z API, co spowoduje błędy w konsoli. To normalne - aplikacja będzie działać, ale funkcje wymagające API (koszyk, zamówienia) nie będą działać.

2. **HTTPS:** Upewnij się, że hosting obsługuje HTTPS (Cyberfolks zwykle tak). Frontend powinien działać zarówno na HTTP jak i HTTPS, ale zaleca się użycie HTTPS w produkcji.

3. **Backup:** Zawsze rób backup istniejących plików przed wdrożeniem nowych.

4. **Cache przeglądarki:** Po wdrożeniu możesz potrzebować wyczyścić cache przeglądarki (Ctrl+F5) aby zobaczyć zmiany.

5. **Nagłówki Cache-Control:** Jeśli widzisz stare treści na niektórych urządzeniach, upewnij się że plik `.htaccess` został przesłany na serwer i działa poprawnie.

## Następne kroki

Po wdrożeniu frontendu:

1. Wdróż backend API na serwerze
2. Skonfiguruj domenę API (jeśli backend będzie na subdomenie, np. `api.twoja-domena.pl`)
3. Przebuduj frontend z poprawnym URL API: `VITE_API_URL="https://api.twoja-domena.pl/api" npm run build`
4. Prześlij zaktualizowany frontend na hosting
