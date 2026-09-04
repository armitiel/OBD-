# OBD AI Scanner MVP — instalacja i pierwszy test

## Co zainstalować

Plik: `OBD-AI-Scanner-MVP-0.4.0-debug.apk`

To testowa, podpisana wersja Android. Minimalny system: Android 6.0.

## Instalacja

1. Skopiuj APK na Galaxy przez kabel USB, Dysk Google lub wiadomość do siebie.
2. Otwórz APK na telefonie.
3. Jeżeli Android zapyta, zezwól aplikacji Pliki lub przeglądarce na instalowanie nieznanych aplikacji.
4. Zainstaluj OBD AI Scanner.

## Przygotowanie auta

1. W ustawieniach Bluetooth telefonu sparuj ELM327. Typowy PIN to `1234` albo `0000`.
2. Zamknij Car Scanner i wszystkie inne aplikacje OBD.
3. Włóż ELM327 do gniazda OBD-II w Saabie.
4. Włącz zapłon. Pierwszy test najlepiej wykonać na postoju.

## Test

1. Uruchom OBD AI Scanner i przyznaj dostęp do pobliskich urządzeń.
2. Wybierz sparowany ELM327.
3. Naciśnij **Połącz i uruchom ELM**.
4. Sprawdź, czy terminal pokazuje odpowiedzi na `ATZ`, `ATE0`, `ATI` i `ATSP0`.
5. Naciśnij **Sprawdź ECU i PID-y**.
6. Oczekiwany protokół dla Saaba 9-3 2.8T B284: `ISO 15765-4 (CAN 11/500)`.
7. Aplikacja powinna wyświetlić obroty, prędkość, temperaturę płynu i pozycję przepustnicy.
8. Naciśnij **Uruchom Live Data**. Na postoju obserwuj przez 30–60 sekund zmieniające się wartości i szybkość adaptera w PID/s.
9. Naciśnij **Zatrzymaj Live Data**, a następnie **Udostępnij log**.

## Dziennik testu

- Terminal zapisuje dziennik automatycznie w pamięci aplikacji i zachowuje go po jej zamknięciu.
- Nowe połączenie dodaje wyraźny znacznik **NOWA SESJA TESTOWA**.
- Po teście naciśnij **Udostępnij log**, aby utworzyć plik `.txt` i wysłać go bez robienia zrzutów ekranu.
- Paczki Live Data zapisują się w tym samym dzienniku jako wiersze zaczynające się od `LIVE`.
- **Wyczyść** usuwa zapisany dziennik z aplikacji, dlatego użyj go dopiero po eksporcie.

## Plan pomiaru AI

Wersja 0.4.0 ma ekran opisu objawu. Backend wybiera wyłącznie PID-y ze stałej listy dozwolonych odczytów. Do testu przez kabel uruchom backend na komputerze, wykonaj `adb reverse tcp:8787 tcp:8787`, a w aplikacji pozostaw adres `http://127.0.0.1:8787`.

Klucz `OPENAI_API_KEY` zapisuje się tylko na backendzie. Nie należy wpisywać go w aplikacji ani kompilować w APK.

## Gdy nie łączy

- upewnij się, że Car Scanner jest całkowicie zamknięty;
- wyłącz i włącz Bluetooth;
- wyjmij ELM327 na 10 sekund i włóż ponownie;
- sprawdź, czy zapłon jest włączony;
- rozłącz i ponownie sparuj adapter w ustawieniach telefonu;
- zachowaj dokładny tekst z terminala — przyda się do dopasowania obsługi konkretnego klona ELM327.

## Backend i wersja webowa

Backend nie jest potrzebny do połączenia, terminala, Live Data ani lokalnego recordera. Będzie potrzebny dopiero dla bezpiecznej diagnozy AI, kont i synchronizacji logów. React jest już pakowany wewnątrz APK i działa offline; publiczny hosting strony nie jest potrzebny do obsługi ELM327.
