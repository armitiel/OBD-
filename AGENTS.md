# OBD AI Scanner — instrukcja dla agentów

Ten plik jest punktem startowym dla każdego agenta pracującego w repozytorium. Przed zmianami przeczytaj także:

1. `docs/PROJECT_ASSUMPTIONS.md`
2. `docs/ARCHITECTURE.md`
3. `docs/API_CONTRACT.md`
4. `docs/DEVELOPMENT_AND_TESTING.md`
5. `docs/ROADMAP.md`
6. `docs/DATA_PLATFORM.md`
7. `docs/AGENT_ARCHITECTURE.md`
8. `database/README.md`

## Cel produktu

Aplikacja Android łączy się z klasycznym adapterem Bluetooth ELM327, pobiera wyłącznie dane diagnostyczne OBD-II, zapisuje pomiar i komunikuje się z backendem AI. AI ma dobierać najmniejszy użyteczny zestaw danych do opisanego objawu, a po teście analizować zebrane próbki i proponować dalsze bezpieczne sprawdzenia.

Samochód referencyjny: Saab 9-3 2.8T B284, ISO 15765-4 CAN 11-bit 500 kbaud. Telefon referencyjny: Samsung Galaxy A30s z Androidem 11. Adapter testowy identyfikuje się jako ELM327 v1.5.

## Stan referencyjny

Aktualna wersja projektu: `0.5.0`.

Zaimplementowane:

- React + TypeScript + Vite + Capacitor 7;
- natywny plugin Android Bluetooth Classic SPP;
- lista sparowanych urządzeń i zapamiętanie ELM327;
- inicjalizacja `ATZ`, `ATE0`, `ATI`, `ATSP0`;
- wykrycie ECU i podstawowe PID-y;
- Live Data z wykrywaniem obsługiwanych PID-ów;
- lokalny trwały dziennik i udostępnianie pliku tekstowego;
- ekran opisu objawu i wyboru planu danych przez backend AI;
- backend z `GET /health`, `POST /v1/diagnostic-plan`, `POST /v1/diagnosis` i `POST /v1/chat`;
- wdrożenie produkcyjne jako funkcje serverless Vercela pod `https://obd-murex.vercel.app/api`;
- strukturalny recorder sesji z automatycznym zakończeniem pomiaru i eksportem JSON;
- ekran raportu AI oddzielający obserwacje od hipotez oraz rozmowa o zebranych danych;
- tryb `AI_MOCK=true` do testu bez kosztów API;
- integracja OpenAI Responses API ze Structured Outputs.

Zweryfikowane na prawdziwym aucie w wersji 0.2.0: połączenie ELM327, protokół CAN oraz odczyt RPM, prędkości, temperatury płynu i przepustnicy. Interfejs planera AI 0.4.0 został zweryfikowany na Galaxy z backendem mock. Pełny pomiar Live Data 0.4.0 na aucie nadal wymaga testu z aktywnym adapterem.

## Reguły bezwzględne

- Nie dodawaj zapisu, kodowania, kasowania DTC, sterowania elementami wykonawczymi, Security Access, surowego wstrzykiwania ramek CAN ani flashowania ECU.
- Nie pozwalaj modelowi AI przesyłać dowolnej komendy do ELM327.
- Każdy plan AI filtruj po stronie TypeScript i ponownie po stronie natywnego Androida.
- Klucz `OPENAI_API_KEY` może istnieć wyłącznie na backendzie — w zmiennych środowiskowych Vercela albo w `.env` serwera deweloperskiego. Nigdy w `VITE_*`, kodzie React, Capacitor config ani APK.
- Nie duplikuj logiki AI między `api/` a `server/`. Jedno źródło prawdy to `api/_lib/ai.mjs`.
- Dane AI traktuj jako wskazówki diagnostyczne, nie pewną diagnozę. Oddzielaj obserwacje od hipotez.
- Test drogowy nie może wymagać patrzenia na ekran ani ręcznej obsługi podczas jazdy.
- Nie zgłaszaj testu sprzętowego jako zaliczonego bez rzeczywistych odpowiedzi ELM/ECU w logu.
- Zachowaj zgodność minimum Android 6 (API 23) do czasu świadomej decyzji projektowej.

## Gdzie wprowadzać zmiany

- UI i orkiestracja: `src/App.tsx`, `src/components/`
- typy: `src/types/obd.ts`
- transport OBD: `src/services/obdBluetooth.ts`
- walidacja planu AI: `src/services/diagnosticPlanner.ts`
- zapis logów: `src/services/testLog.ts`
- natywny Bluetooth i parsowanie PID: `android/app/src/main/java/pl/obdai/scanner/BluetoothSerialPlugin.java`
- logika AI (wspólna dla produkcji i rozwoju): `api/_lib/ai.mjs`
- funkcje serverless: `api/health.mjs`, `api/v1/*.mjs`
- lokalny serwer deweloperski: `server/index.mjs`
- recorder sesji: `src/services/sessionRecorder.ts`
- schemat i seed bazy: `database/`
- rejestr oraz kontrakty agentów: `agents/`
- zmienne środowiskowe: `.env.example`

## Minimalna walidacja każdej zmiany

1. `npm run build`
2. dla zmian Android: `npm run android:sync` i `gradlew :app:assembleDebug`
3. dla backendu: `AI_MOCK=true npm run backend`, następnie sprawdzenie `/health` i właściwego endpointu;
4. dla zmian UI: kontrola na szerokości telefonu oraz brak błędów konsoli;
5. dla zmian OBD: test na postoju, eksport dziennika i zachowanie surowych odpowiedzi.

Nie modyfikuj plików wygenerowanych w `dist/`, `android/app/build/` ani `node_modules/` ręcznie.
