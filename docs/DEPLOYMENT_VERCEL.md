# Backend AI na Vercelu

Stan: 2026-09-04, wersja 0.5.0. Projekt `obd` w zespole `armitiels-projects`, adres produkcyjny `https://obd-murex.vercel.app`.

## Co jest wdrożone

Jedno wdrożenie obsługuje dwie rzeczy:

- statyczny build Vite z `dist/` — interfejs aplikacji w trybie demonstracyjnym przeglądarki;
- funkcje serverless z katalogu `api/` — backend AI.

| Ścieżka | Metoda | Rola |
|---|---|---|
| `/api/health` | GET | stan konfiguracji, bez ujawniania sekretów |
| `/api/v1/diagnostic-plan` | POST | dobór PID-ów do objawu |
| `/api/v1/diagnosis` | POST | analiza zakończonej sesji |
| `/api/v1/chat` | POST | rozmowa o zebranym pomiarze |

Cała logika modelu żyje w `api/_lib/ai.mjs`. Katalogi i pliki zaczynające się od `_` nie stają się trasami, więc ten sam moduł importuje zarówno Vercel, jak i lokalny `server/index.mjs`. Dzięki temu nie ma dwóch kopii promptów ani schematów.

## Zmienne środowiskowe

Ustawiane w panelu Vercela (Project → Settings → Environment Variables) albo przez `vercel env add <NAZWA> production`:

| Zmienna | Wymagana | Znaczenie |
|---|---|---|
| `OPENAI_API_KEY` | tak, do prawdziwej analizy | klucz dostawcy modelu; bez niego endpointy zwracają `503` |
| `OPENAI_MODEL` | nie | domyślnie `gpt-5.4-mini` |
| `AI_MOCK` | nie | `true` włącza atrapy odpowiedzi bez kosztów API |
| `OBD_ACCESS_TOKEN` | zalecana | gdy ustawiona, każde żądanie musi nieść nagłówek `X-Obd-Token` |
| `OBD_ALLOWED_ORIGIN` | zalecana | ogranicza CORS; domyślnie `*` |

Po zmianie zmiennej trzeba wykonać nowe wdrożenie — Vercel nie wstrzykuje ich do już zbudowanych funkcji.

## Wdrożenie

Katalog jest podlinkowany do projektu (`.vercel/`, poza repozytorium). Ręczne wdrożenie produkcyjne:

```powershell
vercel deploy --prod --yes
```

`.vercelignore` wyłącza z paczki `android/`, `outputs/`, `database/`, `docs/` i pliki `.apk`, żeby nie wysyłać kilkudziesięciu megabajtów przy każdym wdrożeniu.

## Weryfikacja po wdrożeniu

```bash
curl https://obd-murex.vercel.app/api/health
```

`aiConfigured: true` i `mockMode: false` oznaczają backend gotowy do prawdziwej analizy. `aiConfigured: false` to brak klucza — endpointy odpowiedzą wtedy `503` z czytelnym komunikatem.

## Ograniczenia

- Funkcje serverless nie mają dostępu do bazy PostgreSQL na VPS OVH, bo ta nasłuchuje wyłącznie na `127.0.0.1`. Spięcie backendu z bazą będzie wymagało albo tunelu, albo przeniesienia backendu na VPS.
- Brak limitów żądań. Dopóki nie ma `OBD_ACCESS_TOKEN`, każdy, kto zna adres, może zużywać budżet API.
- Domyślny czas wykonania funkcji na planie darmowym bywa krótszy niż analiza dużej sesji. Jeżeli `/v1/diagnosis` będzie kończyć się timeoutem, trzeba ograniczyć liczbę punktów szeregu albo przenieść analizę na VPS.
