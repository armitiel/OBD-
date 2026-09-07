package pl.obdai.scanner;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

/**
 * Usługa pierwszoplanowa na czas pomiaru. Sama nie zbiera danych — robi to
 * {@link ObdRecorder}. Jej zadaniem jest utrzymać proces przy życiu i pokazać
 * użytkownikowi, że aplikacja pracuje w tle, czego Android wymaga.
 */
public class ObdRecordingService extends Service {

    public static final String ACTION_START = "pl.obdai.scanner.RECORDING_START";
    public static final String ACTION_STOP = "pl.obdai.scanner.RECORDING_STOP";
    private static final String CHANNEL_ID = "obd-recording";
    private static final int NOTIFICATION_ID = 4711;

    private static Context applicationContext;

    public static void start(Context context, String planTitle, int durationSeconds) {
        applicationContext = context.getApplicationContext();
        Intent intent = new Intent(applicationContext, ObdRecordingService.class);
        intent.setAction(ACTION_START);
        intent.putExtra("planTitle", planTitle == null ? "Pomiar OBD" : planTitle);
        intent.putExtra("durationSeconds", durationSeconds);
        ContextCompat.startForegroundService(applicationContext, intent);
    }

    public static void stop() {
        if (applicationContext == null) return;
        Intent intent = new Intent(applicationContext, ObdRecordingService.class);
        intent.setAction(ACTION_STOP);
        try {
            applicationContext.startService(intent);
        } catch (Exception ignored) {
            // system mógł już zatrzymać usługę — nic więcej nie trzeba robić
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? ACTION_START : intent.getAction();

        if (ACTION_STOP.equals(action)) {
            ObdRecorder.stop("Pomiar zatrzymany z powiadomienia.");
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }

        String planTitle = intent != null && intent.getStringExtra("planTitle") != null
            ? intent.getStringExtra("planTitle")
            : "Pomiar OBD";
        int durationSeconds = intent != null ? intent.getIntExtra("durationSeconds", 0) : 0;

        createChannel();
        Notification notification = buildNotification(planTitle, durationSeconds);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
        return START_NOT_STICKY;
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID, "Pomiar OBD", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Informuje, że trwa zapis danych z adaptera.");
        channel.setShowBadge(false);
        manager.createNotificationChannel(channel);
    }

    private Notification buildNotification(String planTitle, int durationSeconds) {
        int flags = PendingIntent.FLAG_UPDATE_CURRENT
            | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);

        PendingIntent openApp = PendingIntent.getActivity(
            this, 0, new Intent(this, MainActivity.class), flags);

        Intent stopIntent = new Intent(this, ObdRecordingService.class).setAction(ACTION_STOP);
        PendingIntent stopPending = PendingIntent.getService(this, 1, stopIntent, flags);

        String text = durationSeconds > 0
            ? "Zapis danych z auta · zaplanowano " + durationSeconds + " s"
            : "Zapis danych z auta";

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(planTitle)
            .setContentText(text)
            .setSmallIcon(android.R.drawable.stat_sys_upload)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setContentIntent(openApp)
            .addAction(0, "Zatrzymaj", stopPending)
            .build();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        // abort zamiast stop: usługa już się zamyka, nie wolno jej wskrzeszać
        ObdRecorder.abort("Usługa pomiaru została zatrzymana przez system.");
        super.onDestroy();
    }
}
