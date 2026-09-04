# Platforma danych technicznych

Stan projektu: 2026-09-04. Ten dokument opisuje docelową bibliotekę danych pojazdów oraz sposób jej zasilania.

## 1. Zasada nadrzędna

PostgreSQL jest źródłem prawdy dla danych strukturalnych. Indeks wektorowy jest wyłącznie mechanizmem wyszukiwania fragmentów dokumentów i nie może samodzielnie potwierdzać faktu technicznego.

Każda informacja użyta do planowania pomiaru albo diagnozy musi mieć:

- jednoznaczny obiekt, którego dotyczy;
- źródło i lokalizator w źródle;
- status weryfikacji;
- poziom zaufania i ryzyka;
- datę oraz historię powstania;
- możliwość oznaczenia konfliktu lub zastąpienia nowszą informacją.

## 2. Cztery obszary bazy

### `catalog`

Znormalizowane obiekty motoryzacyjne:

- producenci, modele, generacje i warianty;
- silniki oraz ich aliasy;
- rodziny ECU i instalacje modułów;
- protokoły diagnostyczne;
- standardowe i rozszerzone parametry;
- stosowalność PID-ów do silnika, wariantu i ECU;
- kody DTC oraz ich stosowalność.

### `knowledge`

Pochodzenie i dowody:

- źródła i ich licencje;
- dokumenty oraz sumy kontrolne;
- fragmenty z dokładnym lokalizatorem;
- mapowanie dokumentów do indeksu wyszukiwania;
- atomowe twierdzenia techniczne i dowody za/przeciw.

### `ops`

Proces agentowy:

- zadania importu;
- wykonania agentów, modele i wersje promptów;
- ślad użytych narzędzi;
- kolejka przeglądu człowieka;
- błędy i wyniki przetwarzania.

### `runtime`

Dane aplikacji:

- pojazdy użytkownika bez przechowywania jawnego VIN-u;
- sesje diagnostyczne;
- próbki OBD;
- zaobserwowane DTC;
- raporty AI i odwołania do twierdzeń użytych jako dowód.

## 3. Relacje kluczowe

```text
manufacturer ── vehicle_model ── generation ── vehicle_variant
      │                                  └──── engine
      └──── ecu_family ── module_installation ── protocol

diagnostic_parameter ── parameter_applicability ── engine/variant/ECU

source ── document ── document_chunk
   └──────── claim_evidence ── technical_claim ── subject in catalog

user_vehicle ── diagnostic_session ── obd_sample
                                  └── ai_report ── evidence_claim_ids
```

## 4. Klasy źródeł i zaufanie

Proponowana skala `trust_tier`:

| Tier | Typ źródła | Zastosowanie |
|---|---|---|
| 5 | dokumentacja producenta, obowiązująca regulacja, licencjonowany standard | może potwierdzać dane wysokiego ryzyka |
| 4 | renomowana licencjonowana baza techniczna, oficjalny biuletyn | publikacja po kontroli zgodności |
| 3 | wiarygodna publikacja techniczna, powtarzalny pomiar własny | wymaga potwierdzenia dla danych specyficznych ECU |
| 2 | forum specjalistyczne, katalog części, pojedynczy pomiar | wskazówka do dalszej weryfikacji |
| 1 | treść nieznanego pochodzenia lub automatycznie wygenerowana | tylko kolejka badawcza, nigdy źródło prawdy |

AI nie jest źródłem. Wygenerowana odpowiedź może tworzyć kandydata, ale musi wskazać dowody pochodzące ze źródeł.

## 5. Cykl życia danych

```text
pozyskane źródło
   → kwarantanna i kontrola licencji
   → ekstrakcja dokumentu
   → normalizacja encji
   → kandydat na twierdzenie
   → weryfikacja dowodów i konfliktów
   → przegląd człowieka, jeśli wymagany
   → publikacja
   → monitoring zmian / wycofanie / zastąpienie
```

Statusy twierdzeń: `candidate`, `corroborated`, `verified`, `conflicted`, `rejected`, `superseded`.

Do odpowiedzi produkcyjnej trafiają tylko `verified`. `corroborated` może być pokazane jako niepewna wskazówka, ale nie może samodzielnie określać komendy, formuły ani progu bezpieczeństwa.

## 6. Reguły publikacji

- Standardowy PID Mode 01: co najmniej jedno źródło tier 5 albo dwa niezależne źródła tier 4.
- PID producenta lub adres ECU: źródło tier 5 i ręczna akceptacja.
- Formuła dekodowania: test wektorów wejście/wyjście oraz ręczna akceptacja.
- Procedura serwisowa: kontrola wersji, rynku, roku i wariantu auta.
- Dane obserwacyjne użytkownika: nigdy automatycznie nie stają się właściwością całego modelu.
- Konflikt źródeł: status `conflicted`, brak automatycznej publikacji.
- Brak informacji nie oznacza `unsupported`; używaj `unknown`.

## 7. PID-y i dekodery

W bazie przechowujemy czytelną formułę jako dokumentację, ale kod nie wykonuje dowolnego wyrażenia z bazy. `decoder_key` wskazuje przetestowaną funkcję w kodzie, np. `rpm_ab`, `fuel_trim_a` albo `voltage_ab`.

Rozszerzone PID-y producenta muszą dodatkowo posiadać:

- protokół i sposób adresowania;
- ECU oraz wersję sprzętu/oprogramowania;
- długość i strukturę odpowiedzi;
- zakres i jednostkę;
- warunki aktywności;
- źródło oraz status ręcznego przeglądu.

## 8. Wyszukiwanie hybrydowe

Kolejność pobierania wiedzy dla planera lub diagnosty:

1. dokładne filtrowanie SQL po pojeździe, silniku, ECU, rynku i statusie `published`;
2. pobranie zatwierdzonych twierdzeń i parametrów;
3. wyszukiwanie pełnotekstowe lub wektorowe tylko w dokumentach odpowiadających temu filtrowi;
4. reranking fragmentów;
5. zwrot odpowiedzi z identyfikatorami twierdzeń i źródeł.

OpenAI Vector Stores mogą przechowywać pomocniczy indeks dokumentów i obsługują filtrowanie po atrybutach, ale identyfikatory pliku i magazynu należy mapować w `knowledge.retrieval_files`. Relacyjna baza pozostaje miejscem publikacji i kontroli wersji.

## 9. Skalowanie

MVP może przechowywać próbki w PostgreSQL jako `jsonb`. Przy dużej liczbie sesji:

- partycjonuj `runtime.obd_samples` po dacie;
- rozważ TimescaleDB albo magazyn kolumnowy dla telemetrii;
- surowe duże pliki trzymaj w object storage;
- w bazie zapisuj URI, hash i metadane;
- utrzymuj osobną retencję dla surowych danych, próbek i raportów;
- agreguj statystyki dopiero po anonimizacji i zgodzie użytkownika.

## 10. Prywatność i licencje

- VIN przechowuj jako hash lub szyfrowany sekret tylko wtedy, gdy jest niezbędny.
- Adres MAC adaptera nie jest częścią biblioteki pojazdów.
- Każde źródło ma pola licencji i zgody na redystrybucję.
- Fragment źródła służy do audytu; UI nie może ujawniać treści ponad warunki licencji.
- Dane sesji użytkownika i biblioteka referencyjna mają osobne role oraz polityki retencji.

## 11. Pliki wdrożeniowe

- `database/migrations/001_initial.sql` — schemat PostgreSQL;
- `database/seeds/001_reference_catalog.sql` — początkowy katalog Saab/OBD, dane Saab mają status kandydata;
- `database/compose.yaml` — lokalny PostgreSQL 16;
- `agents/registry.yaml` — role agentów i ich uprawnienia;
- `agents/contracts/` — schematy walidujące wyjście agentów.
