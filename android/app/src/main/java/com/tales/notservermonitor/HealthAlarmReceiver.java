package com.tales.notservermonitor;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class HealthAlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        PendingResult pendingResult = goAsync();
        Thread thread = new Thread(() -> {
            try {
                NotificationHelper.recordResult(context.getApplicationContext(), HealthChecker.check());
                UpdateManager.checkAndDownload(context.getApplicationContext(), false);
            } finally {
                pendingResult.finish();
            }
        }, "notserver-health-check");
        thread.start();
    }
}
