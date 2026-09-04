# Założenia projektowe

Stan dokumentu: 2026-09-04. Wersja odniesienia: 0.4.0.

## 1. Problem i wartość produktu

Typowy skaner OBD pokazuje wiele liczb bez wyjaśnienia, które z nich są istotne dla konkretnego objawu. OBD AI Scanner ma prowadzić użytkownika przez bezpieczny pomiar:

1. użytkownik opisuje objaw prostym językiem;
2. AI wybiera potrzebne dane z zamkniętego katalogu;
3. telefon rejestruje tylko dostępne i istotne PID-y;
4. backend analizuje przebieg w kontekście auta oraz warunków testu;
5. aplikacja pokazuje obserwacje, hipotezy, poziom pewności i następne sprawdzenia.

Produkt nie zastępuje mechanika ani dokumentacji serwisowej. Ma skrócić drogę od objawu do sensownego, udokumentowanego testu.

## 2. Użytkownik i środowisko

- Główny użytkownik nie musi znać komend ELM327 ani wzorów PID.
- Telefon jest stale dostępny przy samochodzie i może działać offline podczas samego odczytu.
- Internet jest potrzebny tylko do uzyskania planu AI, wysłania pomiaru do analizy oraz synchronizacji.
- Pierwszym samochodem referencyjnym jest Saab 9-3 2.8T B284.
- Pierwszym adapterem jest tani ELM327 Bluetooth Classic, wcześniej działający z Car Scanner.
- Zakładany protokół auta: ISO 15765-4 CAN 11-bit, 500 kbaud.

## 3. Zakres funkcjonalny

### Zaimplementowane

- połączenie ze sparowanym adapterem Bluetooth Classic;
- inicjalizacja ELM327 i terminal diagnostyczny;
- automatyczne wykrycie protokołu i odpowiedzi ECU;
- odczyt podstawowy oraz ciągłe Live Data;
- wykrywanie bitmap obsługiwanych PID-ów `0100`, `0120`, `0140`;
- lokalny dziennik do 2000 wpisów i eksport `.txt`;
- wybór planu pomiaru przez backend AI;
- backend mock i integracja OpenAI Responses API;
- podwójna walidacja PID-ów.

### Najbliższy zakres

- recorder przechowujący próbki strukturalnie, nie tylko jako tekst terminala;
- automatyczne zakończenie testu po czasie z planu;
- opis warunków testu: silnik zimny/ciepły, postój/jazda, bieg, obciążenie;
- wysłanie znormalizowanego zapisu do `/v1/diagnosis`;
- ekran raportu AI i możliwość wykonania kolejnego planu;
- obsługa kodów DTC jako odczytu, bez funkcji kasowania.

### Poza zakresem

- flashowanie i strojenie ECU;
- kodowanie modułów;
- kasowanie DTC;
- sterowanie elementami wykonawczymi;
- obejście zabezpieczeń ECU;
- automatyczna decyzja, że auto jest bezpieczne do dalszej jazdy;
- odczyt specyficznych PID-ów producenta bez osobnego rozpoznania protokołu i dokumentacji.

## 4. Decyzje techniczne

- React + TypeScript zapewniają szybkie rozwijanie interfejsu.
- Capacitor opakowuje UI w APK, natomiast Bluetooth Classic jest natywny, ponieważ przeglądarka nie zapewnia wymaganej komunikacji SPP.
- Backend jest oddzielony od APK, aby chronić klucz dostawcy AI i umożliwić zmianę modelu bez aktualizacji aplikacji.
- OpenAI Responses API jest używane ze Structured Outputs. Domyślny model w konfiguracji to `gpt-5.4-mini`, ale model jest zmienną środowiskową `OPENAI_MODEL`.
- MVP nie wymaga bazy danych. Recorder może początkowo zapisywać sesje lokalnie. Baza stanie się potrzebna dla kont, synchronizacji, historii między urządzeniami i centralnych analiz.
- Publiczna aplikacja webowa nie jest wymagana do obsługi auta. Może później służyć jako panel raportów i administracji.

## 5. Zasada sterowania przez AI

AI nie steruje adapterem. AI zwraca deklaratywny `DiagnosticPlan` zawierający identyfikator, tytuł, uzasadnienie, czas pomiaru i listę PID-ów. Następnie:

1. backend ogranicza wynik schematem JSON;
2. klient filtruje PID-y przez `ALLOWED_LIVE_PIDS`;
3. Android porównuje żądanie z własnym, stałym katalogiem;
4. Android odpytuje tylko PID-y zgłoszone przez ECU jako obsługiwane;
5. odpowiedzi są rejestrowane z czasem.

Ta separacja ma pozostać nawet wtedy, gdy katalog odczytów zostanie rozszerzony.

## 6. Wymagania jakościowe

- Brak utraty całej sesji przy braku odpowiedzi pojedynczego PID-u.
- Jawne znaczniki czasu i surowe odpowiedzi w logach diagnostycznych.
- Czytelny interfejs na ekranie 720 × 1560 oraz starszych urządzeniach.
- Rozłączenie lub zamknięcie ekranu musi zatrzymywać pętlę odczytu.
- Ręczny terminal jest blokowany w trakcie Live Data, aby nie mieszać odpowiedzi.
- Błędy sieci AI nie mogą blokować lokalnego odczytu bazowego.
- Produkcyjny backend musi używać HTTPS, uwierzytelniania, limitów żądań i ograniczonego CORS.

## 7. Prywatność

Minimalizuj wysyłane dane. Do planera wystarczą: profil auta, opis objawu i lista dostępnych parametrów. Do analizy wysyłaj próbki OBD, warunki testu oraz opcjonalne DTC. Nie wysyłaj kontaktów, lokalizacji, identyfikatorów telefonu ani pełnego adresu MAC adaptera, jeśli nie są potrzebne.
