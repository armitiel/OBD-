package pl.obdai.scanner;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothSocket;
import android.app.Activity;
import android.os.Build;
import android.view.WindowManager;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(
    name = "BluetoothSerial",
    permissions = {
        @Permission(
            alias = "bluetooth",
            strings = { Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.BLUETOOTH_SCAN }
        )
    }
)
public class BluetoothSerialPlugin extends Plugin implements ObdRecorder.Sampler {
    private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    private static final int DEFAULT_TIMEOUT_MS = 3500;
    private static final Set<String> SAFE_AT_COMMANDS = new java.util.HashSet<>(java.util.Arrays.asList(
        "ATZ", "ATE0", "ATE1", "ATI", "ATSP0", "ATDP", "ATDPN", "ATRV", "AT@1",
        "ATL0", "ATL1", "ATS0", "ATS1", "ATH0", "ATH1", "ATAT0", "ATAT1", "ATAT2"
    ));
    private static final String[][] LIVE_PID_DEFINITIONS = {
        { "010C", "Obroty silnika" },
        { "010B", "Ciśnienie MAP" },
        { "0110", "Przepływ MAF" },
        { "0106", "STFT Bank 1" },
        { "0107", "LTFT Bank 1" },
        { "0108", "STFT Bank 2" },
        { "0109", "LTFT Bank 2" },
        { "0105", "Płyn chłodzący" },
        { "010F", "Powietrze dolotowe" },
        { "0104", "Obciążenie silnika" },
        { "0111", "Przepustnica" },
        { "010D", "Prędkość" },
        { "010E", "Wyprzedzenie zapłonu" },
        { "0133", "Ciśnienie atmosferyczne" },
        { "0142", "Napięcie modułu" }
    };
    private final ExecutorService serialExecutor = Executors.newSingleThreadExecutor();
    private final Object ioLock = new Object();

    private BluetoothAdapter adapter;
    private BluetoothSocket socket;
    private InputStream input;
    private OutputStream output;
    private String connectedAddress;
    private final Set<Integer> supportedPids = new HashSet<>();

    @Override
    public void load() {
        BluetoothManager manager = (BluetoothManager) getContext().getSystemService(android.content.Context.BLUETOOTH_SERVICE);
        adapter = manager == null ? null : manager.getAdapter();
    }

    @PluginMethod
    public void requestPermissions(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || getPermissionState("bluetooth") == PermissionState.GRANTED) {
            JSObject result = new JSObject();
            result.put("granted", true);
            call.resolve(result);
            return;
        }
        requestPermissionForAlias("bluetooth", call, "bluetoothPermissionResult");
    }

    @PermissionCallback
    private void bluetoothPermissionResult(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", getPermissionState("bluetooth") == PermissionState.GRANTED);
        call.resolve(result);
    }

    @PluginMethod
    public void getPairedDevices(PluginCall call) {
        if (!hasBluetoothPermission(call)) return;
        if (adapter == null) {
            call.reject("Ten telefon nie obsługuje Bluetooth.");
            return;
        }
        if (!adapter.isEnabled()) {
            call.reject("Bluetooth jest wyłączony. Włącz go w ustawieniach telefonu.");
            return;
        }

        try {
            Set<BluetoothDevice> bonded = adapter.getBondedDevices();
            JSArray devices = new JSArray();
            for (BluetoothDevice device : bonded) {
                JSObject item = new JSObject();
                String name = device.getName();
                item.put("name", name == null || name.trim().isEmpty() ? "Urządzenie Bluetooth" : name);
                item.put("address", device.getAddress());
                devices.put(item);
            }
            JSObject result = new JSObject();
            result.put("devices", devices);
            call.resolve(result);
        } catch (SecurityException error) {
            call.reject("Brak uprawnienia Bluetooth.", error);
        }
    }

    @PluginMethod
    public void connect(PluginCall call) {
        if (!hasBluetoothPermission(call)) return;
        String address = call.getString("address");
        if (address == null || !BluetoothAdapter.checkBluetoothAddress(address)) {
            call.reject("Nieprawidłowy adres urządzenia Bluetooth.");
            return;
        }
        if (adapter == null || !adapter.isEnabled()) {
            call.reject("Bluetooth jest niedostępny lub wyłączony.");
            return;
        }

        serialExecutor.execute(() -> {
            closeConnection();
            try {
                BluetoothDevice device = adapter.getRemoteDevice(address);
                adapter.cancelDiscovery();
                BluetoothSocket newSocket = openSocket(device);
                synchronized (ioLock) {
                    socket = newSocket;
                    input = newSocket.getInputStream();
                    output = newSocket.getOutputStream();
                    connectedAddress = address;
                }
                JSObject result = new JSObject();
                result.put("connected", true);
                call.resolve(result);
            } catch (Exception error) {
                closeConnection();
                call.reject("Nie udało się połączyć z ELM327: " + safeMessage(error), error);
            }
        });
    }

    /**
     * Standardowe gniazdo SPP, a przy niepowodzeniu obejście przez refleksję na
     * kanale 1. Tanie klony ELM327 często odrzucają pierwsze podejście błędem
     * "read failed, socket might closed or timeout, read ret: -1", zwłaszcza
     * krótko po zamknięciu poprzedniego połączenia.
     */
    private BluetoothSocket openSocket(BluetoothDevice device) throws IOException {
        try {
            BluetoothSocket socket = device.createRfcommSocketToServiceRecord(SPP_UUID);
            socket.connect();
            return socket;
        } catch (IOException firstAttempt) {
            // Adapter potrzebuje chwili po odrzuconym połączeniu; 18 ms z
            // sleepBriefly() to za mało dla stosu Bluetooth.
            try { Thread.sleep(600); } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                throw firstAttempt;
            }
            try {
                BluetoothSocket fallback = (BluetoothSocket) device.getClass()
                    .getMethod("createRfcommSocket", int.class)
                    .invoke(device, 1);
                if (fallback == null) throw firstAttempt;
                fallback.connect();
                return fallback;
            } catch (IOException retryFailed) {
                throw retryFailed;
            } catch (Exception reflectionFailed) {
                throw firstAttempt;
            }
        }
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        // Rozłączenie kończy też ewentualny pomiar w tle — inaczej rejestrator
        // waliłby w zamknięte gniazdo aż do pierwszego wyjątku.
        ObdRecorder.stop("Rozłączono adapter.");
        applyKeepAwake(false);
        serialExecutor.execute(() -> {
            closeConnection();
            call.resolve();
        });
    }

    @PluginMethod
    public void isConnected(PluginCall call) {
        JSObject result = new JSObject();
        boolean connected = socket != null && socket.isConnected();
        result.put("connected", connected);
        if (connectedAddress != null) result.put("address", connectedAddress);
        call.resolve(result);
    }

    /**
     * Utrzymuje ekran włączony na czas pomiaru. Bez tego WebView zostaje
     * wstrzymany po wygaszeniu ekranu i pętla Live Data przestaje zbierać próbki
     * w połowie testu drogowego.
     */
    @PluginMethod
    public void setKeepAwake(PluginCall call) {
        applyKeepAwake(Boolean.TRUE.equals(call.getBoolean("enabled", false)));
        call.resolve();
    }

    private void applyKeepAwake(final boolean enabled) {
        final Activity activity = getActivity();
        if (activity == null) return;
        activity.runOnUiThread(() -> {
            if (enabled) {
                activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            } else {
                activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            }
        });
    }

    @PluginMethod
    public void sendCommand(PluginCall call) {
        String command = normalizeCommand(call.getString("command"));
        int timeoutMs = Math.max(500, Math.min(call.getInt("timeoutMs", DEFAULT_TIMEOUT_MS), 15000));
        if (command.isEmpty()) {
            call.reject("Komenda nie może być pusta.");
            return;
        }
        if (!isReadOnlyCommand(command)) {
            call.reject("Komenda zablokowana: to wydanie pozwala wyłącznie na bezpieczny odczyt OBD-II.");
            return;
        }
        serialExecutor.execute(() -> {
            try {
                JSObject result = new JSObject();
                result.put("response", exchange(command, timeoutMs));
                call.resolve(result);
            } catch (Exception error) {
                call.reject("Błąd komunikacji ELM327: " + safeMessage(error), error);
            }
        });
    }

    @PluginMethod
    public void initializeElm(PluginCall call) {
        serialExecutor.execute(() -> {
            try {
                JSArray responses = new JSArray();
                addExchange(responses, "ATZ", 5500);
                addExchange(responses, "ATE0", 3000);
                addExchange(responses, "ATI", 3000);
                addExchange(responses, "ATSP0", 3000);
                JSObject result = new JSObject();
                result.put("responses", responses);
                call.resolve(result);
            } catch (Exception error) {
                call.reject("Inicjalizacja ELM327 nie powiodła się: " + safeMessage(error), error);
            }
        });
    }

    @PluginMethod
    public void scanBasicPids(PluginCall call) {
        serialExecutor.execute(() -> {
            try {
                String supportedRaw = exchange("0100", 5500);
                boolean ecuConnected = containsPidReply(supportedRaw, "00");
                String protocolRaw = exchange("ATDP", 3000);
                String protocol = cleanElmText(protocolRaw);

                JSArray readings = new JSArray();
                if (ecuConnected) {
                    addPidReading(readings, "010C", "Obroty silnika", exchange("010C", 3500));
                    addPidReading(readings, "010D", "Prędkość", exchange("010D", 3500));
                    addPidReading(readings, "0105", "Płyn chłodzący", exchange("0105", 3500));
                    addPidReading(readings, "0111", "Przepustnica", exchange("0111", 3500));
                }

                JSObject result = new JSObject();
                result.put("protocol", protocol.isEmpty() ? "Nieznany" : protocol);
                result.put("ecuConnected", ecuConnected);
                result.put("readings", readings);
                call.resolve(result);
            } catch (Exception error) {
                call.reject("Nie udało się odczytać ECU: " + safeMessage(error), error);
            }
        });
    }

    @PluginMethod
    public void readLiveData(PluginCall call) {
        serialExecutor.execute(() -> {
            try {
                call.resolve(readBatch(pidSetFromCall(call.getArray("pids"))));
            } catch (Exception error) {
                call.reject("Odczyt Live Data nie powiódł się: " + safeMessage(error), error);
            }
        });
    }

    private Set<String> pidSetFromCall(JSArray requested) {
        Set<String> pids = new HashSet<>();
        if (requested == null) return pids;
        for (int index = 0; index < requested.length(); index++) {
            pids.add(requested.optString(index, "").toUpperCase(Locale.US));
        }
        return pids;
    }

    /**
     * Jedna paczka odczytów. Wspólna dla wywołania z WebView i dla natywnego
     * rejestratora, żeby tryb w tle nie miał własnej, rozjeżdżającej się kopii
     * walidacji PID-ów.
     *
     * Lista z planu AI jest tu przecinana z zamkniętym katalogiem
     * LIVE_PID_DEFINITIONS oraz z bitmapą zgłoszoną przez ECU — to trzeci,
     * niezależny poziom walidacji, obok backendu i warstwy TypeScript.
     */
    @Override
    public JSObject readBatch(Set<String> requestedPids) throws Exception {
        long startedAt = android.os.SystemClock.elapsedRealtime();
        if (supportedPids.isEmpty()) detectSupportedPids();

        // Katalog bezpiecznych PID-ów przecięty z planem — to jest warstwa
        // bezpieczeństwa i obowiązuje zawsze.
        List<String[]> targets = new ArrayList<>();
        for (String[] definition : LIVE_PID_DEFINITIONS) {
            if (requestedPids.isEmpty() || requestedPids.contains(definition[0])) targets.add(definition);
        }

        // Bitmapa obsługiwanych PID-ów to optymalizacja, nie zabezpieczenie.
        // Jeżeli auto zgłosiło bitmapę, z której nie wychodzi ani jeden PID
        // z planu, odpytujemy plan mimo wszystko — zapytanie trybu 01 jest
        // tylko odczytem, a ECU po prostu odpowie NO DATA. Wcześniej błędnie
        // odczytana bitmapa cicho zamieniała cały pomiar w zero próbek.
        List<String[]> supportedTargets = new ArrayList<>();
        for (String[] definition : targets) {
            if (supportedPids.contains(Integer.parseInt(definition[0].substring(2), 16))) supportedTargets.add(definition);
        }
        boolean ignoredSupportBitmap = supportedTargets.isEmpty() && !targets.isEmpty();
        List<String[]> toRead = ignoredSupportBitmap ? targets : supportedTargets;

        JSArray readings = new JSArray();
        for (String[] definition : toRead) {
            try {
                String raw = exchange(definition[0], 1800);
                addLiveReading(readings, definition[0], definition[1], raw);
            } catch (IOException ignored) {
                // Pojedynczy brak odpowiedzi nie przerywa całej paczki Live Data.
            }
        }

        JSObject result = new JSObject();
        result.put("timestamp", System.currentTimeMillis());
        result.put("durationMs", android.os.SystemClock.elapsedRealtime() - startedAt);
        result.put("supportedCount", supportedPids.size());
        result.put("requestedCount", toRead.size());
        result.put("ignoredSupportBitmap", ignoredSupportBitmap);
        result.put("readings", readings);
        return result;
    }

    // ─── Nagrywanie w tle ───────────────────────────────────────────────────

    @PluginMethod
    public void startRecording(PluginCall call) {
        if (ObdRecorder.isRecording()) {
            call.reject("Pomiar już trwa.");
            return;
        }
        if (socket == null || !socket.isConnected()) {
            call.reject("Najpierw połącz adapter.");
            return;
        }
        Set<String> pids = pidSetFromCall(call.getArray("pids"));
        int durationSeconds = call.getInt("durationSeconds", 60);
        String planTitle = call.getString("planTitle", "Pomiar OBD");

        // Świeże wykrycie przed każdym pomiarem. Wcześniej bitmapa była
        // zapamiętywana na czas życia pluginu, więc jedno błędne odczytanie
        // psuło wszystkie kolejne pomiary aż do restartu aplikacji.
        JSObject result = ObdRecorder.status();
        try {
            supportedPids.clear();
            result.put("detection", detectSupportedPids());
            result.put("supportedCount", supportedPids.size());
        } catch (Exception error) {
            result.put("detectionError", safeMessage(error));
        }

        ObdRecordingService.start(getContext(), planTitle, durationSeconds);
        ObdRecorder.start(getContext(), this, pids, durationSeconds);
        applyKeepAwake(true);
        call.resolve(result);
    }

    @PluginMethod
    public void stopRecording(PluginCall call) {
        ObdRecorder.stop(call.getString("reason", "Pomiar zatrzymany ręcznie."));
        applyKeepAwake(false);
        call.resolve(ObdRecorder.status());
    }

    @PluginMethod
    public void getRecordingStatus(PluginCall call) {
        call.resolve(ObdRecorder.status());
    }

    @PluginMethod
    public void drainSamples(PluginCall call) {
        JSObject result = new JSObject();
        result.put("batches", ObdRecorder.drain(call.getInt("fromIndex", 0)));
        result.put("status", ObdRecorder.status());
        call.resolve(result);
    }

    @PluginMethod
    public void resetRecording(PluginCall call) {
        ObdRecorder.reset();
        call.resolve();
    }

    private void addExchange(JSArray target, String command, int timeoutMs) throws IOException {
        JSObject item = new JSObject();
        item.put("command", command);
        item.put("response", exchange(command, timeoutMs));
        target.put(item);
    }

    private String exchange(String command, int timeoutMs) throws IOException {
        synchronized (ioLock) {
            ensureConnected();
            while (input.available() > 0) input.read();
            output.write((command + "\r").getBytes(StandardCharsets.US_ASCII));
            output.flush();

            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            long deadline = System.currentTimeMillis() + timeoutMs;
            boolean promptReceived = false;
            while (System.currentTimeMillis() < deadline) {
                int available = input.available();
                if (available == 0) {
                    sleepBriefly();
                    continue;
                }
                for (int index = 0; index < available; index++) {
                    int value = input.read();
                    if (value < 0) throw new IOException("Połączenie zostało zamknięte.");
                    buffer.write(value);
                    if (value == '>') {
                        promptReceived = true;
                        break;
                    }
                }
                if (promptReceived) break;
            }
            if (buffer.size() == 0) throw new IOException("Brak odpowiedzi (timeout " + timeoutMs + " ms).");
            String response = buffer.toString(StandardCharsets.US_ASCII.name()).trim();
            if (!promptReceived) response += "\n[timeout przed znakiem >]";
            return response;
        }
    }

    private void addPidReading(JSArray readings, String command, String label, String raw) {
        String pid = command.substring(2);
        List<Integer> data = extractPidData(raw, pid);
        if (data.isEmpty()) return;
        JSObject reading = new JSObject();
        reading.put("pid", command);
        reading.put("label", label);
        reading.put("value", formatPidValue(pid, data));
        reading.put("raw", raw);
        readings.put(reading);
    }

    /** @return surowe odpowiedzi na zapytania o bitmapy, do wglądu w dzienniku */
    private JSArray detectSupportedPids() throws IOException {
        JSArray trace = new JSArray();
        supportedPids.clear();
        for (String command : new String[] { "0100", "0120", "0140" }) {
            if (command.equals("0120") && !supportedPids.contains(0x20)) break;
            if (command.equals("0140") && !supportedPids.contains(0x40)) break;
            String raw = exchange(command, 3500);
            addSupportedRange(Integer.parseInt(command.substring(2), 16), raw);
            JSObject item = new JSObject();
            item.put("command", command);
            item.put("response", raw);
            trace.put(item);
        }
        return trace;
    }

    /**
     * Sumuje bitmapy ze WSZYSTKICH modułów, które odpowiedziały. Wcześniej brana
     * była tylko pierwsza ramka, przez co przy kilku ECU lista obsługiwanych
     * PID-ów wychodziła szczątkowa i Live Data nie odpytywało niczego.
     */
    private void addSupportedRange(int basePid, String raw) {
        String responsePid = String.format(Locale.US, "%02X", basePid);
        for (String line : responseLines(raw)) {
            List<Integer> data = extractPidDataFromLine(line, responsePid);
            if (data.size() < 4) continue;
            long bitmap = ((long) data.get(0) << 24)
                | ((long) data.get(1) << 16)
                | ((long) data.get(2) << 8)
                | data.get(3);
            for (int bit = 0; bit < 32; bit++) {
                if ((bitmap & (1L << (31 - bit))) != 0) supportedPids.add(basePid + bit + 1);
            }
        }
    }

    private void addLiveReading(JSArray readings, String command, String label, String raw) {
        String pid = command.substring(2);
        List<Integer> data = extractPidData(raw, pid);
        if (data.isEmpty()) return;
        int a = data.get(0);
        int b = data.size() > 1 ? data.get(1) : 0;
        double value;
        String unit;
        int digits;
        switch (pid) {
            case "04": value = a * 100.0 / 255.0; unit = "%"; digits = 1; break;
            case "05": value = a - 40; unit = "°C"; digits = 0; break;
            case "06":
            case "07":
            case "08":
            case "09": value = (a - 128) * 100.0 / 128.0; unit = "%"; digits = 1; break;
            case "0B": value = a; unit = "kPa"; digits = 0; break;
            case "0C":
                if (data.size() < 2) return;
                value = (256.0 * a + b) / 4.0; unit = "rpm"; digits = 0; break;
            case "0D": value = a; unit = "km/h"; digits = 0; break;
            case "0E": value = a / 2.0 - 64.0; unit = "°"; digits = 1; break;
            case "0F": value = a - 40; unit = "°C"; digits = 0; break;
            case "10":
                if (data.size() < 2) return;
                value = (256.0 * a + b) / 100.0; unit = "g/s"; digits = 2; break;
            case "11": value = a * 100.0 / 255.0; unit = "%"; digits = 1; break;
            case "33": value = a; unit = "kPa"; digits = 0; break;
            case "42":
                if (data.size() < 2) return;
                value = (256.0 * a + b) / 1000.0; unit = "V"; digits = 2; break;
            default: return;
        }
        JSObject reading = new JSObject();
        reading.put("pid", command);
        reading.put("label", label);
        reading.put("value", value);
        reading.put("unit", unit);
        reading.put("formatted", String.format(Locale.getDefault(), "%." + digits + "f %s", value, unit));
        reading.put("raw", raw);
        readings.put(reading);
    }

    private boolean containsPidReply(String raw, String pid) {
        return !extractPidData(raw, pid).isEmpty();
    }

    /**
     * Rozbija odpowiedź ELM na pojedyncze ramki. Przy CAN odpowiada zwykle
     * kilka modułów (7E8, 7E9…), a każdy w osobnej linii. Sklejanie ich w jeden
     * ciąg powodowało, że parser brał bajty z sąsiedniej ramki.
     */
    private List<String> responseLines(String raw) {
        List<String> lines = new ArrayList<>();
        if (raw == null) return lines;
        for (String line : raw.split("[\r\n]+")) {
            String trimmed = line.trim();
            if (trimmed.isEmpty() || trimmed.equals(">")) continue;
            lines.add(trimmed);
        }
        if (lines.isEmpty() && raw.trim().length() > 0) lines.add(raw.trim());
        return lines;
    }

    /** Pierwsza ramka, która niesie dane dla tego PID-u. */
    private List<Integer> extractPidData(String raw, String pid) {
        for (String line : responseLines(raw)) {
            List<Integer> data = extractPidDataFromLine(line, pid);
            if (!data.isEmpty()) return data;
        }
        return new ArrayList<>();
    }

    private List<Integer> extractPidDataFromLine(String raw, String pid) {
        String normalized = raw.toUpperCase(Locale.US).replaceAll("[^0-9A-F]", " ").trim();
        String[] tokens = normalized.isEmpty() ? new String[0] : normalized.split("\\s+");
        List<Integer> bytes = new ArrayList<>();
        for (int i = 0; i + 1 < tokens.length; i++) {
            if (tokens[i].equals("41") && tokens[i + 1].equals(pid)) {
                for (int j = i + 2; j < tokens.length; j++) {
                    if (tokens[j].length() != 2) break;
                    try { bytes.add(Integer.parseInt(tokens[j], 16)); }
                    catch (NumberFormatException ignored) { break; }
                }
                break;
            }
        }
        if (bytes.isEmpty()) {
            String compact = raw.toUpperCase(Locale.US).replaceAll("[^0-9A-F]", "");
            String marker = "41" + pid;
            int markerIndex = compact.indexOf(marker);
            if (markerIndex >= 0) {
                String payload = compact.substring(markerIndex + marker.length());
                for (int index = 0; index + 1 < payload.length() && bytes.size() < 4; index += 2) {
                    try { bytes.add(Integer.parseInt(payload.substring(index, index + 2), 16)); }
                    catch (NumberFormatException ignored) { break; }
                }
            }
        }
        return bytes;
    }

    private String formatPidValue(String pid, List<Integer> data) {
        int a = data.get(0);
        switch (pid) {
            case "0C":
                if (data.size() < 2) return "Niepełna odpowiedź";
                return ((256 * a + data.get(1)) / 4) + " rpm";
            case "0D": return a + " km/h";
            case "05": return (a - 40) + " °C";
            case "11": return String.format(Locale.getDefault(), "%.1f %%", a * 100.0 / 255.0);
            default: return String.format(Locale.US, "0x%02X", a);
        }
    }

    private String cleanElmText(String raw) {
        return raw.replace(">", "").replace("\r", " ").replace("\n", " ").replaceAll("\\s+", " ").trim();
    }

    private String normalizeCommand(String command) {
        return command == null ? "" : command.replaceAll("\\s", "").trim().toUpperCase(Locale.US);
    }

    private boolean isReadOnlyCommand(String command) {
        if (SAFE_AT_COMMANDS.contains(command)) return true;
        return command.matches("^(01|02|03|09|0A)[0-9A-F]*$");
    }

    private void ensureConnected() throws IOException {
        if (socket == null || !socket.isConnected() || input == null || output == null) {
            throw new IOException("Brak aktywnego połączenia Bluetooth.");
        }
    }

    private boolean hasBluetoothPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && getPermissionState("bluetooth") != PermissionState.GRANTED) {
            call.reject("Brak uprawnienia do pobliskich urządzeń Bluetooth.");
            return false;
        }
        return true;
    }

    private void sleepBriefly() throws IOException {
        try { Thread.sleep(18); }
        catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            throw new IOException("Operacja przerwana.", error);
        }
    }

    private String safeMessage(Exception error) {
        String message = error.getMessage();
        return message == null || message.trim().isEmpty() ? error.getClass().getSimpleName() : message;
    }

    private void closeConnection() {
        synchronized (ioLock) {
            try { if (input != null) input.close(); } catch (IOException ignored) {}
            try { if (output != null) output.close(); } catch (IOException ignored) {}
            try { if (socket != null) socket.close(); } catch (IOException ignored) {}
            input = null;
            output = null;
            socket = null;
            connectedAddress = null;
            supportedPids.clear();
        }
    }

    @Override
    protected void handleOnDestroy() {
        applyKeepAwake(false);
        // Gdy pomiar leci w tle, aktywność może zostać zniszczona (np. zamknięcie
        // aplikacji z listy zadań) — gniazdo Bluetooth musi wtedy przeżyć, bo
        // rejestrator wciąż z niego korzysta. Usługa pierwszoplanowa trzyma proces.
        if (!ObdRecorder.isRecording()) {
            closeConnection();
            serialExecutor.shutdownNow();
        }
        super.handleOnDestroy();
    }
}
