# Architektura agentów danych technicznych

## 1. Model działania

Nie budujemy grupy agentów swobodnie modyfikujących bazę. Orkiestrator uruchamia wyspecjalizowane role, a każda z nich ma mały kontrakt wejścia/wyjścia i minimalne uprawnienia.

```text
Source Scout → License Gate → Document Extractor → Entity Resolver
                                                   │
                                                   ▼
                                        Technical Mapper
                                                   │
                         ┌─────────────────────────┴─────────────────────┐
                         ▼                                               ▼
                  Formula Validator                              Conflict Verifier
                         └─────────────────────────┬─────────────────────┘
                                                   ▼
                                            Human Review
                                                   ▼
                                             Publisher
                                                   │
                   ┌───────────────────────────────┴─────────────────────┐
                   ▼                                                     ▼
             Runtime Planner                                      Diagnostic Analyst
```

## 2. Role

### 2.1 Source Scout

Cel: znaleźć potencjalne źródła dla konkretnej marki, generacji, silnika albo ECU.

- zapisuje wyłącznie kandydatów w `knowledge.sources`;
- nie pobiera treści zabronionej licencją;
- nie tworzy opublikowanych faktów;
- wynik: URL, wydawca, typ, zakres, przewidywany tier i powód przydatności.

### 2.2 License Gate

Cel: ocenić, czy dokument można pobrać, indeksować, cytować i redystrybuować.

- może oznaczyć źródło jako `active`, `rejected` lub wymagające człowieka;
- brak jasnej licencji oznacza brak zgody na redystrybucję;
- dla płatnych baz wymaga potwierdzenia posiadanej licencji.

### 2.3 Document Extractor

Cel: wydobyć tekst, tabele, nagłówki i lokalizatory.

- zapisuje dokumenty i fragmenty;
- zachowuje numery stron, sekcje i identyfikatory tabel;
- nie interpretuje danych jako prawdy technicznej;
- wykrywa skany wymagające OCR i błędy kodowania.

### 2.4 Entity Resolver

Cel: połączyć nazwy i aliasy z kanonicznymi encjami.

- rozpoznaje producenta, model, generację, silnik, rynek i ECU;
- nie scala encji przy niskiej pewności;
- tworzy `review_item` dla konfliktów typu `B284` kontra podobny kod;
- nie nadpisuje opublikowanej encji bez wersjonowanej decyzji.

### 2.5 Technical Mapper

Cel: tworzyć kandydatów na parametry, DTC, procedury i twierdzenia.

- wyjście musi przejść `technical_claim.schema.json`;
- każdy kandydat zawiera dowód i lokalizator;
- nie publikuje;
- nie generuje dowolnych komend diagnostycznych.

### 2.6 Formula Validator

Cel: sprawdzić dekodowanie parametrów.

- działa na `decoder_key`, długości danych, jednostce i wektorach testowych;
- porównuje wartości graniczne;
- odrzuca dzielenie przez zero, overflow, błędny znak i niezgodne jednostki;
- nigdy nie wykonuje kodu ani wyrażenia dostarczonego przez źródło/AI;
- PID producenta zawsze kieruje do ręcznej akceptacji.

### 2.7 Conflict Verifier

Cel: poszukać niezależnego potwierdzenia i sprzeczności.

- kontroluje, czy dwa dowody nie są kopiami tego samego źródła;
- porównuje rynek, rok modelowy, ECU i wersję oprogramowania;
- nadaje `corroborated`, `verified` albo `conflicted` zgodnie z polityką;
- dla danych bezpieczeństwa nie może pominąć człowieka.

### 2.8 Human Review

Cel: zatwierdzić elementy wysokiego ryzyka.

Obowiązkowy dla:

- PID-ów producenta;
- adresów CAN i sesji diagnostycznych;
- formuł dekodowania spoza standardowego Mode 01;
- progów określających awarię lub bezpieczeństwo;
- procedur serwisowych;
- konfliktów wiarygodnych źródeł;
- zmian licencyjnych.

### 2.9 Publisher

Cel: atomowo przenieść zatwierdzony zestaw do warstwy produkcyjnej.

- nie używa modelu do podejmowania decyzji;
- sprawdza constraints, dowody, status recenzji i testy;
- publikuje zmianę albo odrzuca całość;
- zapisuje autora, wersję i identyfikator zmian.

### 2.10 Runtime Planner

Cel: dobrać parametry do objawu i dostępnego auta.

- czyta tylko opublikowany katalog;
- zwraca deklaratywny plan PID-ów;
- nie ma narzędzia do zapisu do ECU;
- wybór jest przecinany z możliwościami auta i allowlistą Androida;
- przy braku wiedzy używa bezpiecznego planu bazowego.

### 2.11 Diagnostic Analyst

Cel: analizować gotową sesję.

- najpierw oblicza fakty i anomalie deterministycznie;
- pobiera zatwierdzoną wiedzę z cytowaniami;
- oddziela obserwacje od hipotez;
- zwraca poziom pewności i dalsze odczyty;
- nie twierdzi, że część należy wymienić bez wystarczających danych.

### 2.12 Safety Auditor

Cel: końcowa kontrola odpowiedzi dla użytkownika.

- blokuje zapis, kasowanie, kodowanie, aktywne testy i flashowanie;
- sprawdza, czy zalecenie testu drogowego nie wymaga obsługi telefonu przez kierowcę;
- wykrywa nieudokumentowane twierdzenia;
- może obniżyć pewność lub skierować raport do człowieka.

## 3. Uprawnienia

| Agent | Odczyt źródeł | Zapis staging | Zapis katalogu published | Dane użytkownika |
|---|---:|---:|---:|---:|
| Source Scout | tak | sources | nie | nie |
| License Gate | tak | source status | nie | nie |
| Extractor | tak | documents/chunks | nie | nie |
| Entity Resolver | tak | candidate entities | nie | nie |
| Technical Mapper | tak | claims | nie | nie |
| Formula Validator | tak | validation result | nie | nie |
| Conflict Verifier | tak | claim status/review | nie | nie |
| Publisher | tak | nie | tak, po bramkach | nie |
| Runtime Planner | published only | nie | nie | kontekst minimum |
| Diagnostic Analyst | published only | nie | nie | jedna sesja |
| Safety Auditor | raport + dowody | decyzja audytu | nie | jedna sesja |

## 4. Orkiestracja i stan

- Każde uruchomienie ma `ops.agent_runs` z wersją agenta, modelu i promptu.
- Duże zadanie importu ma `ops.ingestion_jobs`.
- Handoff przekazuje identyfikatory encji i artefakt JSON, nie niekontrolowany opis rozmowy.
- Każdy krok jest idempotentny po `input_hash`.
- Retry dotyczy tylko błędów przejściowych; konflikt danych nie jest błędem technicznym.
- Zmiana opublikowanych danych wymaga nowego rekordu lub jawnego `supersedes_claim_id`.
- Ślady agentów nie przechowują sekretów ani całych płatnych dokumentów.

OpenAI zaleca współczesne wzorce Agents SDK dla orkiestracji, tracingu, handoffów i stanu. Dla MVP można pozostać przy deterministycznym workflow w Node, ale kontrakty i ślad wykonania powinny już odpowiadać przyszłej migracji.

## 5. Pobieranie wiedzy przez agentów runtime

Runtime Planner i Diagnostic Analyst nie przeszukują całej sieci w trakcie zwykłej diagnozy. Używają narzędzi:

- `resolve_vehicle(profile)` — zwraca kanoniczny wariant i poziom pewności;
- `list_supported_parameters(vehicle, ecu)` — tylko opublikowane parametry;
- `get_verified_claims(subject, predicates)` — fakty z dowodami;
- `search_technical_documents(query, filters)` — fragmenty filtrowane po aucie i źródle;
- `get_session_summary(session_id)` — zagregowane próbki bez niepotrzebnych danych osobowych;
- `request_human_review(reason, evidence_ids)` — eskalacja.

Żaden agent runtime nie dostaje funkcji `send_obd_command`. Aplikacja realizuje tylko wcześniej zwalidowany plan.

## 6. Ewaluacja

Minimalny zestaw testowy agentów:

- prawidłowe dopasowanie modelu i silnika przy aliasach;
- odrzucenie PID-u spoza katalogu;
- konflikt dwóch wersji modelowych;
- brak źródła dla wygenerowanej tezy;
- fałszywe utożsamienie korelacji z przyczyną;
- różnica bank 1/bank 2;
- brak wymaganych danych w sesji;
- próba nakłonienia do kasowania błędów lub zapisu;
- instrukcja testu drogowego potencjalnie rozpraszająca kierowcę;
- dokument o niejasnej licencji.

Mierniki: precision encji, odsetek twierdzeń z dowodem, skuteczność wykrycia konfliktu, naruszenia safety, koszt na dokument/sesję, latency i odsetek eskalacji.
