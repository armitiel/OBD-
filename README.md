# OBD AI Scanner — MVP Android

Dokumentacja dla agentów i deweloperów zaczyna się w [`AGENTS.md`](AGENTS.md). Pełne założenia, architektura, API, platforma danych i procedury testowe są w katalogu [`docs/`](docs/). Schemat PostgreSQL znajduje się w [`database/`](database/), a role i kontrakty agentów w [`agents/`](agents/).

Bezpieczny, tylko-do-odczytu klient ELM327 Bluetooth Classic dla Androida. Wersja 0.5.0 obejmuje listę sparowanych urządzeń, połączenie SPP, inicjalizację `ATZ`, `ATE0`, `ATI`, `ATSP0`, terminal surowych komend, trwały dziennik testu, Live Data, dobór planu pomiaru przez AI, strukturalny recorder sesji, raport diagnostyczny oraz rozmowę o zebranych danych.

Backend produkcyjny stoi na Vercelu: `https://obd-murex.vercel.app/api`. Pod tym samym adresem działa interfejs w trybie demonstracyjnym przeglądarki — cały przepływ (plan AI → pomiar → raport → rozmowa) można przejść bez adaptera i bez telefonu.

Terminal zapisuje automatycznie do 2000 ostatnich wpisów w pamięci aplikacji. Przycisk **Udostępnij log** tworzy czytelny plik `.txt` zawierający urządzenie, protokół, komendy, odpowiedzi, błędy i znaczniki czasu.

Minimalna wersja systemu to Android 6.0 (API 23). Projekt używa Capacitor 7, aby zachować zgodność ze starszym telefonem; nie podnoś go automatycznie do Capacitor 8 bez sprawdzenia wymagań urządzenia.

## Uruchomienie interfejsu

```powershell
npm install
npm run dev
```

W przeglądarce aplikacja działa w jasno oznaczonym trybie demonstracyjnym. Prawdziwe Bluetooth Classic jest dostępne tylko w kompilacji Android.

## Android

1. Zainstaluj Android Studio z JDK 21 i Android SDK.
2. Uruchom `npm run android:sync`.
3. Uruchom `npm run android:open` i zbuduj APK w Android Studio.
4. W telefonie najpierw sparuj ELM327 w ustawieniach Bluetooth.
5. Włącz zapłon, uruchom aplikację, udziel dostępu do pobliskich urządzeń i wybierz adapter.

### Instalacja gotowego APK

1. Skopiuj `OBD-AI-Scanner-MVP-0.4.0-debug.apk` na Galaxy.
2. Otwórz plik i jednorazowo zezwól aplikacji używanej do otwarcia pliku na instalowanie nieznanych aplikacji.
3. Sparuj ELM327 w ustawieniach Bluetooth Androida. Jeżeli adapter wymaga PIN-u, najczęściej jest to `1234` albo `0000`.
4. Zamknij Car Scanner i inne programy OBD — połączenie Bluetooth SPP zwykle jest dostępne tylko dla jednej aplikacji.
5. Podłącz adapter do auta, włącz zapłon, uruchom OBD AI Scanner i wybierz urządzenie z listy.

APK debug jest przeznaczone do testów na prywatnym telefonie. Publikacja w Google Play będzie wymagała osobnego klucza wydaniowego, polityki prywatności i kompilacji release.

Plugin używa standardowego profilu Bluetooth SPP (`00001101-0000-1000-8000-00805F9B34FB`). Terminal ma natywną listę dozwolonych komend: bezpieczne polecenia konfiguracyjne AT oraz odczytowe usługi OBD-II `01`, `02`, `03`, `09` i `0A`. Tryby kasowania DTC, sterowania elementami, surowe ramki CAN, kodowanie i flashowanie są blokowane.

## Live Data

Po potwierdzeniu połączenia z ECU przyciskiem **Sprawdź ECU i PID-y** można uruchomić ciągły odczyt. Aplikacja najpierw sprawdza bitmapy obsługiwanych PID-ów, a następnie odpytuje tylko parametry dostępne w aucie: RPM, MAP, MAF, STFT/LTFT dla obu banków, temperatury, obciążenie, przepustnicę, prędkość, kąt zapłonu, ciśnienie atmosferyczne i napięcie modułu. Każda paczka wraz z szybkością adaptera jest automatycznie dopisywana do dziennika.

## Pomiar, raport i rozmowa

Po dobraniu planu i uruchomieniu Live Data aplikacja zapisuje strukturalną sesję: każda paczka staje się próbką z czasem liczonym od startu pomiaru. Pomiar kończy się sam po czasie z planu, a sesja przeżywa zamknięcie aplikacji.

Na czas pomiaru ekran nie gaśnie — plugin natywny ustawia `FLAG_KEEP_SCREEN_ON` i zdejmuje ją po zatrzymaniu odczytu. Bez tego Android wstrzymuje WebView razem z pętlą Live Data i test drogowy urywa się w połowie. Przełączenie się na inną aplikację nadal zatrzyma zapis: nagrywanie w tle wymagałoby usługi pierwszoplanowej, której to wydanie nie ma.

Ekran raportu pokazuje statystyki każdego parametru (min, średnia, max, liczba próbek) i pozwala wysłać sesję do analizy. Raport rozdziela obserwacje od hipotez — hipotezy są oznaczone innym kolorem, bo nie są diagnozą.

Panel rozmowy odpowiada na pytania o konkretny pomiar. Do modelu trafiają statystyki i szereg czasowy przerzedzony do 120 punktów, nie wszystkie próbki. Odpowiedź spoza danych pomiarowych jest w interfejsie wyraźnie oznaczona.

## Następne moduły

Warstwa `src/services/obdBluetooth.ts` oddziela interfejs od transportu. Można na niej zbudować recorder i klienta backendu AI bez przebudowy ekranu połączenia.

Interfejs natywny `readLiveData(pids)` przyjmuje opcjonalną listę parametrów, ale Android ponownie filtruje ją przez zamknięty katalog bezpiecznych PID-ów. Backend AI może dobrać zakres pomiaru do objawu, lecz nie może przesłać do adaptera dowolnej komendy. Klient planera znajduje się w `src/services/diagnosticPlanner.ts`, a backend w `server/index.mjs`.

- **Live Data:** działa lokalnie i nie wymaga backendu; jest dostępne od wersji 0.3.0.
- **Recorder:** może zapisywać logi lokalnie i również nie wymaga backendu.
- **Plan AI:** jest dostępny od wersji 0.4.0 i wymaga backendu pośredniczącego.
- **AI Diagnosis:** endpoint backendu jest przygotowany; aplikacja wymaga jeszcze strukturalnego recordera i ekranu raportu.
- **Konta i synchronizacja:** wymagają backendu oraz bazy danych, ale nie są częścią MVP.
- **Publiczna wersja web:** może służyć jako demonstracja interfejsu, lecz przeglądarka nie zastąpi natywnej obsługi Bluetooth Classic.
