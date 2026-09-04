# Roadmapa

Legenda: `[x]` gotowe, `[~]` częściowo, `[ ]` planowane.

## Etap 1 — komunikacja ELM327

- [x] sparowane urządzenia Bluetooth Classic;
- [x] połączenie SPP;
- [x] inicjalizacja AT;
- [x] surowy terminal;
- [x] allowlista komend tylko do odczytu;
- [x] test na realnym ELM327 i Saabie.

## Etap 2 — dane OBD

- [x] wykrycie ECU i protokołu;
- [x] podstawowe PID-y;
- [x] wykrycie wspieranych PID-ów;
- [x] ciągłe Live Data;
- [~] test pełnego Live Data na aucie po wydaniu 0.4.0;
- [ ] pomiar częstotliwości per PID i adaptacyjne grupowanie zapytań.

## Etap 3 — planowanie AI

- [x] opis objawu;
- [x] kontrakt `DiagnosticPlan`;
- [x] backend mock;
- [x] OpenAI Responses API ze Structured Outputs;
- [x] podwójna walidacja dozwolonych PID-ów;
- [x] test aplikacja → backend mock → plan na Galaxy;
- [ ] test z rzeczywistym kluczem OpenAI;
- [x] opcjonalny token dostępu do backendu (`OBD_ACCESS_TOKEN`);
- [ ] limity żądań i kontrola kosztu.

## Etap 4 — recorder

- [x] wersjonowany format sesji (`ObdSession`, `schemaVersion: 1`);
- [x] próbki z monotonicznym czasem od startu sesji;
- [x] automatyczny czas testu z planu;
- [ ] markery: jałowy, przyspieszenie, odpuszczenie, zdarzenie użytkownika;
- [x] zapis lokalny odporny na zamknięcie aplikacji (co 20 paczek i przy zakończeniu);
- [x] eksport JSON; TXT nadal osobno przez dziennik terminala;
- [x] ograniczenie danych przed wysłaniem (statystyki + szereg przerzedzony do 120 punktów).

## Etap 5 — analiza AI

- [x] endpoint `/v1/diagnosis` i schemat odpowiedzi;
- [x] wysyłka zakończonej sesji;
- [x] ekran obserwacji, hipotez i pewności;
- [x] rozmowa o zebranych danych (`/v1/chat`) z oznaczaniem odpowiedzi spoza pomiaru;
- [ ] dalszy plan testu bez dowolnych komend;
- [ ] porównanie banków i wykrywanie anomalii lokalnych przed AI;
- [ ] testy regresyjne na zapisanych sesjach.

## Etap 6 — produkt

- [x] backend HTTPS (Vercel, `https://obd-murex.vercel.app/api`);
- [ ] uwierzytelnianie i limity;
- [ ] baza sesji i synchronizacja opcjonalna;
- [ ] polityka prywatności i retencji;
- [ ] podpisany build release;
- [ ] telemetria błędów bez wrażliwych danych;
- [ ] profile kolejnych aut i adapterów;
- [ ] opcjonalny webowy panel raportów.

## Platforma danych technicznych

- [x] model relacyjny PostgreSQL dla pojazdów, silników, ECU, PID-ów, DTC i źródeł;
- [x] model twierdzeń, dowodów, konfliktów i przeglądu człowieka;
- [x] rejestr 11 ról agentowych, osobna bramka człowieka i kontrakty JSON;
- [x] migracja sprawdzona na czystym PostgreSQL;
- [ ] podłączenie backendu Node do PostgreSQL;
- [ ] widoki publikacyjne i role least-privilege;
- [ ] pipeline importu dokumentów;
- [ ] hybrydowe wyszukiwanie SQL + indeks dokumentów;
- [ ] panel przeglądu i publikacji danych;
- [ ] testy ewaluacyjne agentów na kontrolowanym korpusie.

## Najbliższe zadanie dla kolejnego agenta

Recorder i analiza AI są gotowe w 0.5.0. Następne w kolejności:

1. markery zdarzeń w trakcie pomiaru (jałowy, przyspieszenie, odpuszczenie) — bez patrzenia w ekran podczas jazdy;
2. lokalne wykrywanie anomalii przed wywołaniem AI: różnica korekt między bankami, MAP niezgodny z obrotami, spadek MAF;
3. odczyt DTC trybem `03` i dołączenie ich do ładunku analizy;
4. limity żądań i kontrola kosztu na backendzie;
5. podłączenie backendu do bazy PostgreSQL i zapis sesji poza telefonem;
6. testy regresyjne na zapisanych sesjach JSON.
