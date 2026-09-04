package pl.obdai.scanner;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothSocket;
import android.os.Build;

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
public class BluetoothSerialPlugin extends Plugin {
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
                BluetoothSocket newSocket = device.createRfcommSocketToServiceRecord(SPP_UUID);
                newSocket.connect();
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

    @PluginMethod
    public void disconnect(PluginCall call) {
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
                long startedAt = android.os.SystemClock.elapsedRealtime();
                if (supportedPids.isEmpty()) detectSupportedPids();
                Set<String> requestedPids = new HashSet<>();
                JSArray requested = call.getArray("pids");
                if (requested != null) {
                    for (int index = 0; index < requested.length(); index++) {
                        String pid = requested.optString(index, "").toUpperCase(Locale.US);
                        requestedPids.add(pid);
                    }
                }
                JSArray readings = new JSArray();
                for (String[] definition : LIVE_PID_DEFINITIONS) {
                    String command = definition[0];
                    if (!requestedPids.isEmpty() && !requestedPids.contains(command)) continue;
                    int pid = Integer.parseInt(command.substring(2), 16);
                    if (!supportedPids.contains(pid)) continue;
                    try {
                        String raw = exchange(command, 1800);
                        addLiveReading(readings, command, definition[1], raw);
                    } catch (IOException ignored) {
                        // Pojedynczy brak odpowiedzi nie przerywa całej paczki Live Data.
                    }
                }
                long durationMs = android.os.SystemClock.elapsedRealtime() - startedAt;
                JSObject result = new JSObject();
                result.put("timestamp", System.currentTimeMillis());
                result.put("durationMs", durationMs);
                result.put("supportedCount", supportedPids.size());
                result.put("readings", readings);
                call.resolve(result);
            } catch (Exception error) {
                call.reject("Odczyt Live Data nie powiódł się: " + safeMessage(error), error);
            }
        });
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

    private void detectSupportedPids() throws IOException {
        supportedPids.clear();
        addSupportedRange(0x00, exchange("0100", 3500));
        if (supportedPids.contains(0x20)) addSupportedRange(0x20, exchange("0120", 3500));
        if (supportedPids.contains(0x40)) addSupportedRange(0x40, exchange("0140", 3500));
    }

    private void addSupportedRange(int basePid, String raw) {
        String responsePid = String.format(Locale.US, "%02X", basePid);
        List<Integer> data = extractPidData(raw, responsePid);
        if (data.size() < 4) return;
        long bitmap = ((long) data.get(0) << 24)
            | ((long) data.get(1) << 16)
            | ((long) data.get(2) << 8)
            | data.get(3);
        for (int bit = 0; bit < 32; bit++) {
            if ((bitmap & (1L << (31 - bit))) != 0) supportedPids.add(basePid + bit + 1);
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

    private List<Integer> extractPidData(String raw, String pid) {
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
        closeConnection();
        serialExecutor.shutdownNow();
        super.handleOnDestroy();
    }
}
