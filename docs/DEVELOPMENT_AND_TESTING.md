# Uruchomienie i testowanie

## Wymagania

- Node.js 22 lub nowszy;
- npm;
- JDK 21;
- Android SDK z platform-tools;
- telefon z włączonym debugowaniem USB;
- sparowany ELM327 Bluetooth Classic.

## Frontend

```powershell
npm install
npm run dev
```

W przeglądarce działa symulator OBD. Nie jest to test Bluetooth Classic.

## Backend bez kosztów AI

PowerShell:

```powershell
$env:AI_MOCK='true'
npm run backend
```

Sprawdzenie:

```powershell
Invoke-RestMethod http://127.0.0.1:8787/health
```

## Backend z OpenAI API

1. Skopiuj `.env.example` jako `.env`.
2. Ustaw `OPENAI_API_KEY` tylko w `.env` lub sekretach hostingu.
3. Ustaw `AI_MOCK=false`.
4. Uruchom `npm run backend`.

Nie umieszczaj klucza w zmiennych zaczynających się od `VITE_`, ponieważ zostałyby dołączone do aplikacji.

## APK

```powershell
npm run android:sync
cd android
./gradlew.bat :app:assembleDebug --console=plain
```

Wynik: `android/app/build/outputs/apk/debug/app-debug.apk`.

## Połączenie telefonu z lokalnym backendem

Przy połączeniu USB:

```powershell
adb reverse tcp:8787 tcp:8787
```

W aplikacji adres backendu pozostaje `http://127.0.0.1:8787`. Reguła reverse znika po restarcie telefonu lub ADB. Lokalny HTTP jest dopuszczony tylko przez manifest debug.

## Test planera AI

1. Uruchom backend z `AI_MOCK=true`.
2. Uruchom aplikację.
3. Wpisz: `brak mocy pod obciążeniem i problem z turbo`.
4. Naciśnij **Dobierz dane przez AI**.
5. Oczekuj planu **Test pod obciążeniem**, 90 sekund oraz PID-ów m.in. RPM, MAP, MAF i korekt paliwowych.
6. Sprawdź w terminalu wpis rozpoczynający się od `AI wybrało plan`.

Ten przepływ został zweryfikowany na Galaxy dla wersji 0.4.0.

## Test z autem

Wykonuj na postoju, chyba że przygotowano drugą osobę obsługującą telefon.

1. Zamknij Car Scanner i inne aplikacje OBD.
2. Podłącz ELM327 i włącz zapłon.
3. Połącz z urządzeniem `OBDII`.
4. Potwierdź odpowiedzi `ATZ`, `ATE0`, `ATI`, `ATSP0`.
5. Uruchom sprawdzenie ECU.
6. Potwierdź protokół ISO 15765-4 CAN 11/500.
7. Utwórz plan AI albo pozostaw plan bazowy.
8. Uruchom Live Data na 30–60 sekund.
9. Zatrzymaj test i wyeksportuj dziennik.

## Kryteria zaliczenia

- aplikacja nie zamyka się awaryjnie;
- właściwy adapter jest wybrany automatycznie lub zapamiętany;
- inicjalizacja kończy się odpowiedziami ELM;
- ECU odpowiada na `0100`;
- Live Data pokazuje co najmniej RPM i jeden dodatkowy PID;
- licznik PID/s jest większy od zera;
- zatrzymanie kończy odczyt bez dalszych wpisów LIVE;
- plan AI nie zawiera niczego spoza allowlisty;
- dziennik zachowuje się po zamknięciu aplikacji i można go udostępnić.

## Znane ograniczenia

- obecny recorder to tekstowy log, bez strukturalnych próbek;
- aplikacja nie wykonuje jeszcze automatycznej analizy po zakończeniu testu;
- dostępność banku 2 i części PID-ów zależy od odpowiedzi ECU;
- klony ELM327 mogą mieć różną szybkość i stabilność;
- jedna aplikacja naraz może utrzymywać gniazdo SPP;
- lokalny backend przez `adb reverse` działa tylko podczas połączenia USB;
- wersja debug dopuszcza HTTP; produkcja musi używać HTTPS.
