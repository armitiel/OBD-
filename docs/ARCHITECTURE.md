# Architektura

## 1. Widok całości

```text
Użytkownik
   │ opis objawu
   ▼
React UI w APK ───── HTTPS ─────► Backend Node ─────► OpenAI Responses API
   │                                  │                    │
   │ plan dozwolonych PID-ów          │ walidacja JSON     │ plan / analiza
   ▼                                  ▼                    │
TypeScript allowlist ◄──────── DiagnosticPlan ◄────────────┘
   │
   ▼
Capacitor bridge
   │
   ▼
Natywny plugin Android ── Bluetooth SPP ── ELM327 ── CAN ── ECU
   │                           tylko odczyt Mode 01
   ▼
Próbki + surowe odpowiedzi ──► recorder / log ──► analiza AI
```

## 2. Moduły

### React

- `App.tsx` zarządza połączeniem, stanem ECU, planem i pętlą Live Data.
- `ConnectionPanel` wybiera sparowane urządzenie i steruje połączeniem.
- `EcuStatus` uruchamia podstawowe rozpoznanie ECU.
- `AiPlannerPanel` zbiera objaw, adres backendu i prezentuje plan.
- `LiveDataPanel` prezentuje ostatnią paczkę pomiarową.
- `Terminal` pokazuje i eksportuje ślad komunikacji.

### Usługi TypeScript

- `obdBluetooth.ts` jest jedyną warstwą wywołującą plugin Capacitor. Zawiera także tryb demonstracyjny przeglądarki.
- `diagnosticPlanner.ts` definiuje katalog dozwolonych PID-ów, plan bazowy, klienta HTTP i walidację odpowiedzi backendu.
- `testLog.ts` serializuje ostatnie wpisy do `localStorage` oraz udostępnia plik przez Capacitor.

### Android

`BluetoothSerialPlugin.java` odpowiada za:

- uprawnienia Bluetooth;
- listę sparowanych urządzeń;
- gniazdo RFCOMM/SPP;
- sekwencyjną kolejkę operacji I/O;
- inicjalizację ELM;
- limit czasu i odczyt do znaku zachęty `>`;
- allowlistę poleceń;
- wykrycie dostępnych PID-ów;
- parsowanie standardowych odpowiedzi Mode 01;
- ponowną walidację planu Live Data.

### Backend

`server/index.mjs` jest bezstanowym serwerem HTTP MVP. Odpowiada za:

- sprawdzenie konfiguracji;
- tworzenie planu diagnostycznego;
- analizę gotowego pomiaru;
- wymuszenie struktury odpowiedzi modelu;
- tryb mock do testów bez zewnętrznego wywołania.

## 3. Przebieg sesji

1. Aplikacja pobiera sparowane urządzenia i preferuje nazwę zawierającą `OBD` lub `ELM`.
2. Połączenie otwiera SPP i wykonuje `ATZ`, `ATE0`, `ATI`, `ATSP0`.
3. Test ECU odpytuje `0100`, protokół i kilka podstawowych PID-ów.
4. Użytkownik opisuje objaw; backend zwraca plan.
5. Live Data wysyła listę PID-ów do pluginu.
6. Plugin przecina listę planu z katalogiem bezpiecznym i bitmapą ECU.
7. Paczka wraca do React, trafia na ekran i do dziennika.
8. Docelowy recorder agreguje sesję i przesyła ją do analizy.

## 4. Stany i awarie

- `disconnected`: brak połączenia;
- `connecting`: otwieranie SPP lub inicjalizacja;
- `connected`: ELM gotowy, ECU jeszcze niepotwierdzone;
- `ready`: ECU odpowiada, Live Data dostępne;
- `error`: operacja zakończona błędem.

Brak odpowiedzi jednego PID-u jest pomijany w bieżącej paczce. Utrata całego połączenia kończy pętlę Live Data i zapisuje błąd. Brak backendu AI pozostawia użytkownikowi plan bazowy.

## 5. Topologie uruchomienia backendu

### Rozwój przez USB

- backend działa na komputerze pod portem 8787;
- `adb reverse tcp:8787 tcp:8787` udostępnia go telefonowi jako `http://127.0.0.1:8787`;
- debug manifest dopuszcza lokalny HTTP;
- nie działa po odłączeniu kabla.

### Test w jednej sieci Wi-Fi

- backend nasłuchuje na `0.0.0.0:8787`;
- aplikacja używa adresu LAN komputera, np. `http://192.168.1.20:8787`;
- zapora systemowa musi dopuścić port;
- tylko do sieci zaufanej.

### Produkcja

- backend wdrożony pod stałym adresem HTTPS;
- klucz OpenAI w sekretach serwera;
- uwierzytelnianie aplikacji, limity żądań, obserwowalność i ograniczony CORS;
- release APK nie powinno dopuszczać ruchu cleartext.

## 6. Dane i trwałość

Obecny dziennik tekstowy w `localStorage` jest narzędziem diagnostycznym, nie docelową bazą pomiarów. Recorder powinien przechowywać sesje w wersjonowanym formacie, np.:

```json
{
  "schemaVersion": 1,
  "sessionId": "uuid",
  "vehicle": { "make": "Saab", "model": "9-3", "engine": "B284 2.8T" },
  "plan": { "id": "...", "pids": ["010C", "010B"] },
  "startedAt": "ISO-8601",
  "samples": [
    { "timestamp": 0, "values": { "010C": 781, "010B": 31 } }
  ],
  "events": []
}
```

Wartości powinny być liczbami z jednostką opisaną w katalogu, a surowe odpowiedzi przechowywane osobno do audytu.
