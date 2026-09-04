# Baza danych OBD AI Scanner

## Zawartość

- `migrations/001_initial.sql` — schemat `catalog`, `knowledge`, `ops` i `runtime`;
- `seeds/001_reference_catalog.sql` — Saab, B284, protokół referencyjny oraz 15 standardowych PID-ów;
- `compose.yaml` — lokalny PostgreSQL 16 do prac rozwojowych.

## Start lokalny

```powershell
cd database
$env:POSTGRES_PASSWORD='lokalne-haslo-testowe'
docker compose up -d
```

Migracja z katalogu `migrations/` uruchamia się automatycznie wyłącznie podczas tworzenia nowego wolumenu PostgreSQL. Późniejsze migracje należy wykonywać kontrolowanym narzędziem migracyjnym albo ręcznie z `ON_ERROR_STOP=1`.

Opcjonalny seed:

```powershell
psql "postgresql://obd_ai:lokalne-haslo-testowe@127.0.0.1:5432/obd_ai" -v ON_ERROR_STOP=1 -f seeds/001_reference_catalog.sql
```

Hasło domyślne w `compose.yaml` służy tylko do lokalnego developmentu. Produkcja wymaga sekretu, szyfrowanego połączenia, prywatnej sieci i osobnych ról.

## Role produkcyjne

Zalecane role PostgreSQL:

- `obd_catalog_reader` — SELECT tylko na opublikowanych widokach katalogu;
- `obd_ingestion_writer` — zapis kandydatów w `knowledge` i `ops`;
- `obd_publisher` — kontrolowana publikacja katalogu, bez danych użytkowników;
- `obd_runtime_writer` — sesje, próbki i raporty, bez zmiany biblioteki;
- `obd_reviewer` — statusy recenzji i konfliktów;
- `obd_migrator` — DDL używane wyłącznie przez pipeline wdrożeniowy.

Runtime Planner i Diagnostic Analyst nie powinny łączyć się rolą właściciela bazy.

## Status walidacji

Migracja i seed zostały wykonane 2026-09-04 na czystej, tymczasowej instancji PostgreSQL 18.4 z `ON_ERROR_STOP=1`:

- 27 tabel w czterech schematach;
- 15 wpisów `catalog.diagnostic_parameters`;
- brak błędów migracji i seedowania.

Schemat używa funkcji dostępnych od PostgreSQL 15 (`UNIQUE NULLS NOT DISTINCT`), dlatego wersja minimalna to PostgreSQL 15. Zalecana wersja wdrożeniowa: PostgreSQL 16 lub nowszy.
