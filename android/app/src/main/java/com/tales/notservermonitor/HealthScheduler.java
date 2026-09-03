package com.tales.notservermonitor;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;

public final class HealthScheduler {
    private static final long INTERVAL_MS = 15 * 60 * 1000L;

    private HealthScheduler() {}

    public static void schedule(Context context) {
        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pendingIntent = pendingIntent(context);
        alarmManager.cancel(pendingIntent);
        alarmManager.setInexactRepeating(
            AlarmManager.RTC_WAKEUP,
            System.currentTimeMillis() + 60_000L,
            INTERVAL_MS,
            pendingIntent
        );
    }

    private static PendingIntent pendingIntent(Context context) {
        Intent intent = new Intent(context, HealthAlarmReceiver.class);
        return PendingIntent.getBroadcast(
            context,
            4242,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }
}
