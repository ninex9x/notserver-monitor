package com.tales.notservermonitor;

public final class Config {
    public static final String BASE_URL = BuildConfig.MONITOR_BASE_URL.replaceAll("/+$", "");
    public static final String ACCESS_TOKEN = BuildConfig.MONITOR_ACCESS_TOKEN;
    public static final String ACCESS_COOKIE = "__Host-notserver_access";
    public static final String DASHBOARD_URL = BASE_URL + "/#overview";
    public static final String HEALTH_URL = BASE_URL + "/api/health";
    public static final String UPDATE_METADATA_URL = BASE_URL + "/api/app-update";
    public static final String UPDATE_APK_URL = BASE_URL + "/api/app-update/apk";
    public static final long FOREGROUND_CHECK_INTERVAL_MS = 30_000L;

    private Config() {}
}
