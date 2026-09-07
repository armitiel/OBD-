package pl.obdai.scanner;

import android.content.Context;
import android.os.SystemClock;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;

import java.io.BufferedWriter;
import java.io.File;
import java.io.FileWriter;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * Natywna pętla pomiarowa. Żyje poza WebView, dzięki czemu zapis trwa również
 * wtedy, gdy aplikacja jest w tle albo ekran jest zgaszony — Android dławi
 * wtedy timery JavaScriptu i pętla po stronie WebView przestawałaby zbierać
 * próbki w połowie testu drogowego.
 *
 * Stan jest statyczny, bo nagrywanie ma przeżyć zniszczenie aktywności.
 */
public final class ObdRecorder {

    /** Dostęp do transportu ELM327. Implementuje go plugin, który trzyma gniazdo. */
    public interface Sampler {
        /** Jedna paczka odczytów w formacie LiveDataBatch. Wyjątek kończy nagrywanie. */
        JSObject readBatch(Set<String> pids) throws Exception;
    }

    private static final String TAG = "ObdRecorder";
    private static final long PAUSE_BETWEEN_BATCHES_MS = 250;
    private static final String FILE_NAME = "obd-recording.jsonl";

    private static final Object lock = new Object();
    private static final List<JSObject> batches = new ArrayList<>();

    private static volatile boolean recording = false;
    private static volatile String lastError = null;
    private static volatile String stopReason = null;
    private static long startedAtMs = 0;
    private static long durationMs = 0;
    private static Thread worker = null;
    private static File recordingFile = null;

    private ObdRecorder() {}

    // ─── Sterowanie ─────────────────────────────────────────────────────────

    public static void start(final Context context, final Sampler sampler, final Set<String> pids, int durationSeconds) {
        synchronized (lock) {
            if (recording) return;
            batches.clear();
            lastError = null;
            stopReason = null;
            startedAtMs = SystemClock.elapsedRealtime();
            durationMs = Math.max(15, Math.min(durationSeconds, 900)) * 1000L;
            recording = true;
            recordingFile = new File(context.getFilesDir(), FILE_NAME);
            deleteQuietly(recordingFile);
        }

        final Set<String> requested = new LinkedHashSet<>(pids);
        worker = new Thread(() -> loop(sampler, requested), "obd-recorder");
        worker.setPriority(Thread.NORM_PRIORITY);
        worker.start();
    }

    private static void loop(Sampler sampler, Set<String> pids) {
        while (recording) {
            try {
                JSObject batch = sampler.readBatch(pids);
                synchronized (lock) {
                    if (!recording) break;
                    batches.add(batch);
                }
                appendToFile(batch);
            } catch (Exception error) {
                lastError = error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
                stop("Nagrywanie przerwane: " + lastError);
                return;
            }

            if (SystemClock.elapsedRealtime() - startedAtMs >= durationMs) {
                stop("Pomiar zakończony automatycznie po zaplanowanym czasie.");
                return;
            }
            try {
                Thread.sleep(PAUSE_BETWEEN_BATCHES_MS);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                stop("Nagrywanie przerwane.");
                return;
            }
        }
    }

    /** Zatrzymuje pomiar i prosi usługę pierwszoplanową o wyłączenie. */
    public static void stop(String reason) {
        if (abort(reason)) ObdRecordingService.stop();
    }

    /**
     * Zatrzymanie bez dotykania usługi. Używa tego sama usługa w onDestroy —
     * inaczej wpadlibyśmy w pętlę: usługa gasi rejestrator, a rejestrator
     * ponownie startuje usługę tylko po to, żeby ją zatrzymać.
     *
     * @return true, jeżeli to wywołanie faktycznie zatrzymało trwający pomiar
     */
    public static boolean abort(String reason) {
        synchronized (lock) {
            if (!recording) return false;
            recording = false;
            if (stopReason == null) stopReason = reason;
            return true;
        }
    }

    // ─── Odczyt stanu przez warstwę JS ──────────────────────────────────────

    public static boolean isRecording() {
        return recording;
    }

    public static JSObject status() {
        JSObject result = new JSObject();
        synchronized (lock) {
            result.put("recording", recording);
            result.put("sampleCount", batches.size());
            result.put("elapsedMs", startedAtMs == 0 ? 0 : SystemClock.elapsedRealtime() - startedAtMs);
            result.put("plannedMs", durationMs);
            if (lastError != null) result.put("error", lastError);
            if (stopReason != null) result.put("stopReason", stopReason);
        }
        return result;
    }

    /** Paczki od podanego indeksu. Nic nie usuwa, więc JS może pobrać je ponownie. */
    public static JSArray drain(int fromIndex) {
        JSArray result = new JSArray();
        synchronized (lock) {
            for (int index = Math.max(0, fromIndex); index < batches.size(); index++) {
                result.put(batches.get(index));
            }
        }
        return result;
    }

    public static void reset() {
        synchronized (lock) {
            if (recording) return;
            batches.clear();
            lastError = null;
            stopReason = null;
            startedAtMs = 0;
            durationMs = 0;
            deleteQuietly(recordingFile);
        }
    }

    // ─── Zapis awaryjny ─────────────────────────────────────────────────────
    // Plik nie jest źródłem prawdy dla interfejsu, tylko siatką bezpieczeństwa
    // na wypadek ubicia procesu w trakcie jazdy.

    private static void appendToFile(JSObject batch) {
        File target = recordingFile;
        if (target == null) return;
        try (BufferedWriter writer = new BufferedWriter(new FileWriter(target, true))) {
            writer.write(batch.toString());
            writer.newLine();
        } catch (Exception error) {
            Log.w(TAG, "Nie udało się dopisać próbki do pliku: " + error.getMessage());
        }
    }

    private static void deleteQuietly(File file) {
        if (file != null && file.exists() && !file.delete()) {
            Log.w(TAG, "Nie udało się usunąć poprzedniego zapisu.");
        }
    }

    public static List<JSObject> snapshot() {
        synchronized (lock) {
            return Collections.unmodifiableList(new ArrayList<>(batches));
        }
    }
}
