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
- [ ] autoryzacja i ograniczenia kosztu.

## Etap 4 — recorder

- [ ] wersjonowany format sesji;
- [ ] próbki z monotonicznym czasem;
- [ ] automatyczny czas testu z planu;
- [ ] markery: jałowy, przyspieszenie, odpuszczenie, zdarzenie użytkownika;
- [ ] zapis lokalny odporny na zamknięcie aplikacji;
- [ ] eksport JSON i czytelnego TXT;
- [ ] kompresja/ograniczenie danych przed wysłaniem.

## Etap 5 — analiza AI

- [~] endpoint `/v1/diagnosis` i schemat odpowiedzi;
- [ ] wysyłka zakończonej sesji;
- [ ] ekran obserwacji, hipotez i pewności;
- [ ] dalszy plan testu bez dowolnych komend;
- [ ] porównanie banków i wykrywanie anomalii lokalnych przed AI;
- [ ] testy regresyjne na zapisanych sesjach.

## Etap 6 — produkt

- [ ] backend HTTPS;
- [ ] uwierzytelnianie i limity;
- [ ] baza sesji i synchronizacja opcjonalna;
- [ ] polityka prywatności i retencji;
- [ ] podpisany build release;
- [ ] telemetria błędów bez wrażliwych danych;
- [ ] profile kolejnych aut i adapterów;
- [ ] opcjonalny webowy panel raportów.

## Najbliższe zadanie dla kolejnego agenta

Zaimplementować strukturalny recorder oraz spięcie z `/v1/diagnosis`:

1. utworzyć `ObdSession` i `ObdSample` w `src/types/obd.ts`;
2. agregować wartości z każdej `LiveDataBatch` według `timestamp`;
3. zakończyć pomiar automatycznie po `diagnosticPlan.durationSeconds`;
4. zapisać sesję lokalnie przed wywołaniem sieci;
5. dodać ekran podsumowania i przycisk analizy AI;
6. przesłać ograniczony, wersjonowany payload;
7. zwalidować odpowiedź diagnozy i pokazać obserwacje oddzielnie od hipotez;
8. zachować plan bazowy i eksport offline przy braku backendu.
