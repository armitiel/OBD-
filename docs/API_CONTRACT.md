# Kontrakt backendu AI

Bazowy URL w środowisku deweloperskim: `http://127.0.0.1:8787` przez `adb reverse`. Produkcja: wyłącznie HTTPS.

## GET /health

Odpowiedź `200`:

```json
{
  "ok": true,
  "aiConfigured": true,
  "mockMode": false,
  "model": "gpt-5.4-mini"
}
```

Endpoint nie może ujawniać klucza, pełnej konfiguracji ani danych użytkowników.

## POST /v1/diagnostic-plan

Tworzy deklaratywny, tylko-do-odczytu plan pomiaru.

Żądanie:

```json
{
  "vehicle": {
    "make": "Saab",
    "model": "9-3",
    "engine": "B284 2.8T"
  },
  "symptoms": "Brak mocy pod obciążeniem od 3000 rpm",
  "availablePids": ["0104", "0106", "0107", "0108", "0109", "010B", "010C", "0110", "0111", "0133"]
}
```

Odpowiedź `200`:

```json
{
  "id": "boost-load-v1",
  "title": "Test pod obciążeniem",
  "reason": "Porównanie ciśnienia, przepływu powietrza i korekt obu banków.",
  "pids": ["010C", "0104", "010B", "0133", "0110", "0106", "0107", "0108", "0109", "0111"],
  "durationSeconds": 90
}
```

Ograniczenia:

- minimum 2, maksimum 15 PID-ów;
- czas od 15 do 300 sekund;
- wyłącznie wartości z katalogu;
- backend musi przeciąć wynik z `availablePids`;
- klient i Android wykonują własną walidację niezależnie od backendu.

## POST /v1/diagnosis

Endpoint istnieje w backendzie, ale aplikacja 0.4.0 nie wysyła jeszcze strukturalnego recordera. Docelowe żądanie:

```json
{
  "schemaVersion": 1,
  "vehicle": { "make": "Saab", "model": "9-3", "engine": "B284 2.8T" },
  "symptoms": "Brak mocy pod obciążeniem",
  "conditions": { "engineWarm": true, "testType": "stationary_or_road" },
  "plan": { "id": "boost-load-v1", "pids": ["010C", "010B", "0110"] },
  "samples": [
    { "timestampMs": 0, "values": { "010C": 780, "010B": 31, "0110": 4.8 } }
  ],
  "dtcs": []
}
```

Odpowiedź `200`:

```json
{
  "summary": "Dane pokazują ...",
  "confidence": "medium",
  "findings": ["Zaobserwowano ..."],
  "likelyCauses": ["Możliwa nieszczelność ..."],
  "nextChecks": ["Wykonaj bezpieczny test ..."],
  "safetyNote": "Przerwij jazdę, jeżeli ..."
}
```

AI musi oddzielać fakty od hipotez. `confidence` przyjmuje `low`, `medium` albo `high`.

## Błędy

- `400`: błędne dane, nieprawidłowy plan lub błąd odpowiedzi modelu;
- `404`: nieznany endpoint;
- `413`: docelowo dla przekroczenia limitu rozmiaru;
- `429`: docelowo limit żądań;
- `503`: brak `OPENAI_API_KEY` albo niedostępna usługa AI;
- `5xx`: błąd infrastruktury.

Format błędu:

```json
{ "error": "Czytelny komunikat bez sekretów i stosu wywołań" }
```

## Katalog PID-ów MVP

| PID | Znaczenie | Jednostka |
|---|---|---|
| 0104 | Obciążenie silnika | % |
| 0105 | Temperatura płynu chłodzącego | °C |
| 0106–0109 | STFT/LTFT bank 1 i 2 | % |
| 010B | Ciśnienie bezwzględne w kolektorze | kPa |
| 010C | Obroty silnika | rpm |
| 010D | Prędkość pojazdu | km/h |
| 010E | Wyprzedzenie zapłonu | ° |
| 010F | Temperatura powietrza dolotowego | °C |
| 0110 | Przepływ MAF | g/s |
| 0111 | Pozycja przepustnicy | % |
| 0133 | Ciśnienie atmosferyczne | kPa |
| 0142 | Napięcie modułu | V |

## OpenAI

Backend używa oficjalnego SDK `openai`, Responses API i Structured Outputs z `json_schema`. Konfiguracja:

```env
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5.4-mini
PORT=8787
AI_MOCK=false
```

Klucz należy ustawić w sekretach procesu lub hostingu, nigdy w repozytorium. `store: false` jest ustawione w wywołaniu. Aktualne źródła: [Responses API](https://developers.openai.com/api/reference/typescript/resources/responses/methods/create) i [model GPT-5.4 mini](https://developers.openai.com/api/docs/models/gpt-5.4-mini).

## Wymagania produkcyjne

Przed publicznym wdrożeniem dodać:

- autoryzację lub anonimowe tokeny instalacji;
- ograniczenie CORS do właściwych originów;
- rate limiting per użytkownik/instalacja;
- limit liczby próbek i długości objawu;
- identyfikator żądania i bezpieczne logowanie;
- retry tylko dla błędów przejściowych;
- kontrolę kosztu oraz limity budżetu;
- politykę retencji i usuwania danych;
- wersjonowanie `/v1` i `schemaVersion` recordera.
