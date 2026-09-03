package com.tales.notservermonitor;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;

public final class NotificationHelper {
    public enum HealthState {
        ONLINE,
        VERIFYING,
        OFFLINE,
        AUTHENTICATION_REQUIRED
    }

    private static final String CHANNEL_ID = "server_alerts";
    private static final String PREFS = "health_state";
    private static final String KEY_ONLINE = "last_online";
    private static final String KEY_HAS_STATE = "has_state";
    private static final String KEY_LAST_ALERT = "last_alert";
    private static final String KEY_CONSECUTIVE_FAILURES = "consecutive_failures";
    private static final String KEY_LAST_FAILURE_TYPE = "last_failure_type";
    private static final int NOTIFICATION_ID = 1001;
    private static final int FAILURES_BEFORE_OFFLINE = 2;
    private static final long REPEAT_ALERT_MS = 6 * 60 * 60 * 1000L;

    private NotificationHelper() {}

    public static void createChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "Alertas do servidor",
            NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("Avisa quando a API do notserver deixa de responder.");
        channel.enableVibration(true);
        context.getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }

    public static synchronized HealthState recordResult(Context context, HealthChecker.Result result) {
        SharedPreferences preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        boolean hasState = preferences.getBoolean(KEY_HAS_STATE, false);
        boolean wasOnline = preferences.getBoolean(KEY_ONLINE, true);
        long lastAlert = preferences.getLong(KEY_LAST_ALERT, 0L);
        long now = System.currentTimeMillis();

        if (result.online) {
            if (hasState && !wasOnline) {
                notify(context, "Servidor voltou a responder", "A API do notserver está acessível novamente.", false);
            }
            preferences.edit()
                .putBoolean(KEY_HAS_STATE, true)
                .putBoolean(KEY_ONLINE, true)
                .putInt(KEY_CONSECUTIVE_FAILURES, 0)
                .remove(KEY_LAST_FAILURE_TYPE)
                .apply();
            return HealthState.ONLINE;
        }

        if (result.failureType == HealthChecker.FailureType.AUTHENTICATION) {
            String previousType = preferences.getString(KEY_LAST_FAILURE_TYPE, "");
            if (!HealthChecker.FailureType.AUTHENTICATION.name().equals(previousType) || now - lastAlert >= REPEAT_ALERT_MS) {
                if (notify(context, "Acesso ao monitor recusado", result.message, true)) lastAlert = now;
            }
            preferences.edit()
                .putBoolean(KEY_HAS_STATE, true)
                .putBoolean(KEY_ONLINE, wasOnline)
                .putInt(KEY_CONSECUTIVE_FAILURES, 0)
                .putString(KEY_LAST_FAILURE_TYPE, result.failureType.name())
                .putLong(KEY_LAST_ALERT, lastAlert)
                .apply();
            return HealthState.AUTHENTICATION_REQUIRED;
        }

        int failures = preferences.getInt(KEY_CONSECUTIVE_FAILURES, 0) + 1;
        if (failures < FAILURES_BEFORE_OFFLINE) {
            preferences.edit()
                .putInt(KEY_CONSECUTIVE_FAILURES, failures)
                .putString(KEY_LAST_FAILURE_TYPE, result.failureType.name())
                .apply();
            return HealthState.VERIFYING;
        }

        if (!hasState || wasOnline || now - lastAlert >= REPEAT_ALERT_MS) {
            String title = result.failureType == HealthChecker.FailureType.SERVER_UNREACHABLE
                ? "Servidor indisponível confirmado"
                : "Monitor indisponível em verificações consecutivas";
            String detail = result.failureType == HealthChecker.FailureType.SERVER_UNREACHABLE
                ? "A API confirmou a indisponibilidade em duas verificações consecutivas."
                : "A conexão com a API ou o túnel falhou em duas verificações consecutivas.";
            if (notify(context, title, detail, true)) lastAlert = now;
        }
        preferences.edit()
            .putBoolean(KEY_HAS_STATE, true)
            .putBoolean(KEY_ONLINE, false)
            .putInt(KEY_CONSECUTIVE_FAILURES, failures)
            .putString(KEY_LAST_FAILURE_TYPE, result.failureType.name())
            .putLong(KEY_LAST_ALERT, lastAlert)
            .apply();
        return HealthState.OFFLINE;
    }

    private static boolean notify(Context context, String title, String message, boolean alert) {
        if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return false;
        createChannel(context);
        Intent launchIntent = new Intent(context, MainActivity.class);
        launchIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(
            context,
            0,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        android.app.Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new android.app.Notification.Builder(context, CHANNEL_ID)
            : new android.app.Notification.Builder(context);
        builder.setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(message)
            .setStyle(new android.app.Notification.BigTextStyle().bigText(message))
            .setContentIntent(contentIntent)
            .setAutoCancel(true)
            .setCategory(alert ? android.app.Notification.CATEGORY_ERROR : android.app.Notification.CATEGORY_STATUS)
            .setPriority(alert ? android.app.Notification.PRIORITY_HIGH : android.app.Notification.PRIORITY_DEFAULT);
        context.getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, builder.build());
        return true;
    }
}
