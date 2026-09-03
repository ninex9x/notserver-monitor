package com.tales.notservermonitor;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.os.Build;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;

public final class UpdateManager {
    public static final String ACTION_INSTALL_UPDATE = "com.tales.notservermonitor.INSTALL_UPDATE";
    private static final String CHANNEL_ID = "app_updates";
    private static final String PREFS = "app_updates";
    private static final String KEY_LAST_CHECK = "last_check";
    private static final String KEY_VERSION_CODE = "downloaded_version_code";
    private static final String KEY_VERSION_NAME = "downloaded_version_name";
    private static final long CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000L;
    private static final long MAX_APK_BYTES = 150L * 1024L * 1024L;
    private static final int NOTIFICATION_ID = 1002;

    private UpdateManager() {}

    public static void checkAndDownload(Context context, boolean force) {
        Context appContext = context.getApplicationContext();
        SharedPreferences preferences = appContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        long now = System.currentTimeMillis();
        if (!force && now - preferences.getLong(KEY_LAST_CHECK, 0L) < CHECK_INTERVAL_MS) return;
        preferences.edit().putLong(KEY_LAST_CHECK, now).apply();

        try {
            Metadata metadata = fetchMetadata();
            if (metadata.versionCode <= BuildConfig.VERSION_CODE) {
                clearDownloadedUpdate(appContext, preferences);
                return;
            }

            File apk = updateFile(appContext);
            boolean currentDownload = apk.isFile()
                && preferences.getInt(KEY_VERSION_CODE, 0) == metadata.versionCode
                && metadata.sha256.equals(sha256(apk));
            if (!currentDownload) downloadAndVerify(appContext, metadata, apk);

            preferences.edit()
                .putInt(KEY_VERSION_CODE, metadata.versionCode)
                .putString(KEY_VERSION_NAME, metadata.versionName)
                .apply();
            notifyUpdateReady(appContext, metadata.versionName);
        } catch (Exception ignored) {
            // Uma falha de atualização não deve interferir no monitoramento do servidor.
        }
    }

    public static boolean hasDownloadedUpdate(Context context) {
        SharedPreferences preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        return preferences.getInt(KEY_VERSION_CODE, 0) > BuildConfig.VERSION_CODE && updateFile(context).isFile();
    }

    public static boolean canRequestInstall(Context context) {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.O || context.getPackageManager().canRequestPackageInstalls();
    }

    public static void installDownloaded(Context context) throws Exception {
        if (!hasDownloadedUpdate(context)) throw new IllegalStateException("Nenhuma atualização baixada.");
        PackageInstaller installer = context.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        params.setAppPackageName(context.getPackageName());
        int sessionId = installer.createSession(params);

        try {
            try (PackageInstaller.Session session = installer.openSession(sessionId)) {
                try (InputStream input = new BufferedInputStream(new FileInputStream(updateFile(context)));
                     OutputStream output = session.openWrite("notserver-monitor.apk", 0, updateFile(context).length())) {
                    byte[] buffer = new byte[64 * 1024];
                    int read;
                    while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
                    session.fsync(output);
                }
                Intent result = new Intent(context, UpdateInstallReceiver.class);
                PendingIntent callback = PendingIntent.getBroadcast(
                    context,
                    sessionId,
                    result,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE
                );
                session.commit(callback.getIntentSender());
            }
        } catch (Exception error) {
            installer.abandonSession(sessionId);
            throw error;
        }
    }

    static void notifyInstallFailure(Context context, String detail) {
        if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        createChannel(context);
        android.app.Notification.Builder builder = new android.app.Notification.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("Não foi possível atualizar")
            .setContentText(detail)
            .setStyle(new android.app.Notification.BigTextStyle().bigText(detail))
            .setAutoCancel(true);
        context.getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, builder.build());
    }

    private static Metadata fetchMetadata() throws Exception {
        HttpURLConnection connection = open(Config.UPDATE_METADATA_URL);
        try {
            int status = connection.getResponseCode();
            if (status != 200) throw new IllegalStateException("Metadados indisponíveis: HTTP " + status);
            JSONObject json = new JSONObject(readLimited(connection.getInputStream(), 64 * 1024));
            Metadata metadata = new Metadata(
                json.getInt("versionCode"),
                json.getString("versionName"),
                json.getString("sha256").toLowerCase(),
                json.getLong("size")
            );
            if (!metadata.sha256.matches("^[a-f0-9]{64}$") || metadata.size < 1 || metadata.size > MAX_APK_BYTES) {
                throw new IllegalStateException("Metadados de atualização inválidos.");
            }
            return metadata;
        } finally {
            connection.disconnect();
        }
    }

    private static void downloadAndVerify(Context context, Metadata metadata, File destination) throws Exception {
        File directory = destination.getParentFile();
        if (directory == null || (!directory.isDirectory() && !directory.mkdirs())) throw new IllegalStateException("Não foi possível preparar a atualização.");
        File partial = new File(directory, "notserver-monitor.apk.part");
        HttpURLConnection connection = open(Config.UPDATE_APK_URL);
        try {
            int status = connection.getResponseCode();
            if (status != 200) throw new IllegalStateException("APK indisponível: HTTP " + status);
            long announcedLength = connection.getContentLengthLong();
            if (announcedLength > MAX_APK_BYTES || (announcedLength > 0 && announcedLength != metadata.size)) {
                throw new IllegalStateException("Tamanho inesperado da APK.");
            }

            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            long total = 0;
            try (InputStream input = new BufferedInputStream(connection.getInputStream());
                 OutputStream output = new FileOutputStream(partial)) {
                byte[] buffer = new byte[64 * 1024];
                int read;
                while ((read = input.read(buffer)) != -1) {
                    total += read;
                    if (total > MAX_APK_BYTES) throw new IllegalStateException("APK excedeu o limite permitido.");
                    digest.update(buffer, 0, read);
                    output.write(buffer, 0, read);
                }
            }
            String downloadedHash = toHex(digest.digest());
            if (total != metadata.size || !metadata.sha256.equals(downloadedHash)) throw new IllegalStateException("Assinatura SHA-256 da APK não confere.");
            try {
                Files.move(partial.toPath(), destination.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            } catch (AtomicMoveNotSupportedException error) {
                Files.move(partial.toPath(), destination.toPath(), StandardCopyOption.REPLACE_EXISTING);
            }
        } finally {
            connection.disconnect();
            if (partial.isFile()) partial.delete();
        }
    }

    private static HttpURLConnection open(String address) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(address).openConnection();
        connection.setRequestMethod("GET");
        connection.setConnectTimeout(10_000);
        connection.setReadTimeout(30_000);
        connection.setUseCaches(false);
        connection.setRequestProperty("Accept", "application/json, application/vnd.android.package-archive");
        if (!Config.ACCESS_TOKEN.isBlank()) connection.setRequestProperty("Authorization", "Bearer " + Config.ACCESS_TOKEN);
        return connection;
    }

    private static String readLimited(InputStream stream, int limit) throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[4096];
        int read;
        while ((read = stream.read(buffer)) != -1) {
            if (output.size() + read > limit) throw new IllegalStateException("Resposta de atualização muito grande.");
            output.write(buffer, 0, read);
        }
        return output.toString(StandardCharsets.UTF_8.name());
    }

    private static String sha256(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream input = new BufferedInputStream(new FileInputStream(file))) {
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = input.read(buffer)) != -1) digest.update(buffer, 0, read);
        }
        return toHex(digest.digest());
    }

    private static String toHex(byte[] bytes) {
        StringBuilder value = new StringBuilder(bytes.length * 2);
        for (byte item : bytes) value.append(String.format("%02x", item & 0xff));
        return value.toString();
    }

    private static File updateFile(Context context) {
        return new File(new File(context.getFilesDir(), "updates"), "notserver-monitor.apk");
    }

    private static void clearDownloadedUpdate(Context context, SharedPreferences preferences) {
        File apk = updateFile(context);
        if (apk.isFile()) apk.delete();
        preferences.edit().remove(KEY_VERSION_CODE).remove(KEY_VERSION_NAME).apply();
    }

    private static void createChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Atualizações do aplicativo", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("Avisa quando uma nova versão segura do monitor está pronta para instalar.");
        context.getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }

    private static void notifyUpdateReady(Context context, String versionName) {
        if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        createChannel(context);
        Intent install = new Intent(context, MainActivity.class)
            .setAction(ACTION_INSTALL_UPDATE)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent content = PendingIntent.getActivity(context, 0, install, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        String message = "Versão " + versionName + " baixada. Toque para confirmar a instalação.";
        android.app.Notification.Builder builder = new android.app.Notification.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("Atualização disponível")
            .setContentText(message)
            .setStyle(new android.app.Notification.BigTextStyle().bigText(message))
            .setContentIntent(content)
            .setAutoCancel(true)
            .setCategory(android.app.Notification.CATEGORY_STATUS);
        context.getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, builder.build());
    }

    private static final class Metadata {
        final int versionCode;
        final String versionName;
        final String sha256;
        final long size;

        Metadata(int versionCode, String versionName, String sha256, long size) {
            this.versionCode = versionCode;
            this.versionName = versionName;
            this.sha256 = sha256;
            this.size = size;
        }
    }
}
