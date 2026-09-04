# Wdrożenie bazy na VPS OVH

Stan: 2026-09-04. Instancja produkcyjno-rozwojowa biblioteki wiedzy i danych runtime.

## Serwer

- OVH VPS `vps-4d5f3e30`, Ubuntu 24.04.2 LTS, 2 vCPU, 2 GB RAM, 38 GB dysku;
- alias SSH `ovh-bot` (`~/.ssh/config`), użytkownik `ubuntu`, klucz `~/.ssh/ovh_deploy`;
- serwer współdzieli zasoby z nginx oraz dziewięcioma procesami pm2 — nie uruchamiaj na nim zadań pamięciożernych;
- dodany plik wymiany 2 GB (`/swapfile`, `vm.swappiness=10`) jako zabezpieczenie przed OOM killerem.

## PostgreSQL

- wersja 16.15 z repozytorium Ubuntu (schemat wymaga minimum 15 z powodu `UNIQUE NULLS NOT DISTINCT`);
- konfiguracja strojąca: `/etc/postgresql/16/main/conf.d/10-obd-ai.conf`;
- `listen_addresses = 'localhost'`, `max_connections = 40`, `shared_buffers = 192MB`, `work_mem = 6MB`;
- baza `obd_ai`, właściciel `obd_ai`, kodowanie UTF8, locale `C.UTF-8`.

## Dostęp

Port 5432 nie jest wystawiony na internet: PostgreSQL nasłuchuje wyłącznie na `127.0.0.1`, a `ufw` przepuszcza tylko 22, 80 i 443. Połączenie z zewnątrz wymaga tunelu SSH:

```powershell
ssh -N -L 5432:127.0.0.1:5432 ovh-bot
```

Następnie lokalnie `postgresql://<rola>@127.0.0.1:5432/obd_ai`.

Hasła wszystkich ról leżą na serwerze w `~/.obd-ai/db.env` (uprawnienia 600, katalog 700). Nigdy nie kopiuj tego pliku do repozytorium ani do zmiennych `VITE_*`.

## Role

| Rola | Przeznaczenie | Uprawnienia |
|---|---|---|
| `obd_ai` | właściciel schematu | pełne na bazie |
| `obd_migrator` | pipeline wdrożeniowy (DDL) | dziedziczy `obd_ai` |
| `obd_catalog_reader` | Runtime Planner, odczyt katalogu | SELECT w `catalog` |
| `obd_ingestion_writer` | pipeline ingestii wiedzy | SELECT/INSERT/UPDATE w `knowledge`, `ops`; SELECT w `catalog` |
| `obd_publisher` | publikacja katalogu | pełne w `catalog`, SELECT w `knowledge` |
| `obd_runtime_writer` | sesje, próbki, raporty | SELECT/INSERT/UPDATE w `runtime`; SELECT w `catalog` |
| `obd_reviewer` | recenzje i konflikty | SELECT w `ops`/`knowledge`/`catalog`, UPDATE w `ops` |

`PUBLIC` nie ma prawa łączenia się z bazą ani tworzenia obiektów w `public`. Domyślne uprawnienia (`ALTER DEFAULT PRIVILEGES`) obejmują tabele tworzone w przyszłości przez właściciela.

## Stan po wdrożeniu

Migracja `001_initial.sql` i seed `001_reference_catalog.sql` wykonane z `ON_ERROR_STOP=1`:

- 27 tabel: `catalog` 13, `knowledge` 6, `runtime` 5, `ops` 3;
- 15 pozycji w `catalog.diagnostic_parameters`, 1 producent, 1 silnik;
- rozmiar bazy: ok. 9 MB.

Testy uprawnień: `obd_catalog_reader` czyta katalog i otrzymuje `permission denied` przy próbie zapisu; `obd_runtime_writer` również nie może pisać do `catalog`.

## Kopie zapasowe

`~/.obd-ai/backup.sh` wykonuje `pg_dump -Fc` do `~/.obd-ai/backups/` i kasuje kopie starsze niż 14 dni. Cron uruchamia go codziennie o 03:30 UTC, log w `~/.obd-ai/backup.log`.

Odtworzenie:

```bash
pg_restore -d obd_ai --clean --if-exists ~/.obd-ai/backups/obd_ai-RRRRMMDD-GGMM.dump
```

Kopie leżą na tym samym dysku co baza — przed uznaniem tego za backup produkcyjny trzeba je wynosić poza serwer.

## Do zrobienia przed produkcją

- wynoszenie kopii zapasowych poza VPS;
- osobne konto systemowe dla backendu zamiast `ubuntu`;
- monitoring miejsca na dysku i rozmiaru `knowledge.document_chunks`;
- rotacja haseł ról i wersjonowane narzędzie migracyjne zamiast ręcznego `psql`;
- przy wzroście danych: przeniesienie na instancję z większą ilością RAM (obecne 2 GB dzielone z pm2 to sufit).
