package com.tales.notservermonitor;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.net.Uri;
import android.provider.Settings;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.TextView;

import java.text.DateFormat;
import java.util.Date;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
    private static final int REQUEST_UNKNOWN_SOURCES = 200;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private WebView webView;
    private View offlineOverlay;
    private TextView offlineBadge;
    private TextView offlineTitle;
    private TextView offlineDetail;
    private TextView lastCheck;
    private Button retryButton;
    private boolean checking;
    private boolean pageRequested;

    private final Runnable foregroundHealthLoop = new Runnable() {
        @Override
        public void run() {
            performHealthCheck(false);
            handler.postDelayed(this, Config.FOREGROUND_CHECK_INTERVAL_MS);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
        bindViews();
        configureWebView();
        NotificationHelper.createChannel(this);
        HealthScheduler.schedule(this);
        requestNotificationPermission();
        handleUpdateIntent(getIntent());
        executor.execute(() -> UpdateManager.checkAndDownload(getApplicationContext(), false));
        retryButton.setOnClickListener(view -> {
            pageRequested = false;
            showChecking();
            performHealthCheck(true);
        });
        performHealthCheck(true);
    }

    private void handleUpdateIntent(Intent intent) {
        if (intent == null || !UpdateManager.ACTION_INSTALL_UPDATE.equals(intent.getAction()) || !UpdateManager.hasDownloadedUpdate(this)) return;
        if (!UpdateManager.canRequestInstall(this)) {
            Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName()));
            startActivityForResult(settings, REQUEST_UNKNOWN_SOURCES);
            return;
        }
        executor.execute(() -> {
            try {
                UpdateManager.installDownloaded(getApplicationContext());
            } catch (Exception error) {
                UpdateManager.notifyInstallFailure(getApplicationContext(), error.getMessage() == null ? "Falha ao preparar a instalação." : error.getMessage());
            }
        });
    }

    private void bindViews() {
        webView = findViewById(R.id.dashboard_webview);
        offlineOverlay = findViewById(R.id.offline_overlay);
        offlineBadge = findViewById(R.id.offline_badge);
        offlineTitle = findViewById(R.id.offline_title);
        offlineDetail = findViewById(R.id.offline_detail);
        lastCheck = findViewById(R.id.last_check);
        retryButton = findViewById(R.id.retry_button);
    }

    private void configureWebView() {
        webView.setBackgroundColor(Color.rgb(5, 5, 5));
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccess(false);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false);
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                if (isTrustedUrl(url)) offlineOverlay.setVisibility(View.GONE);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (!request.isForMainFrame()) return;
                pageRequested = false;
                showConnectionIssue(error.getDescription() == null ? "A página do monitor não respondeu" : error.getDescription().toString());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !isTrustedUrl(request.getUrl().toString());
            }
        });
    }

    private void performHealthCheck(boolean forcePageLoad) {
        if (checking) return;
        checking = true;
        executor.execute(() -> {
            HealthChecker.Result result = HealthChecker.check();
            runOnUiThread(() -> {
                checking = false;
                NotificationHelper.HealthState healthState = NotificationHelper.recordResult(getApplicationContext(), result);
                if (result.online) {
                    offlineOverlay.setVisibility(View.GONE);
                    if (forcePageLoad || !pageRequested) {
                        pageRequested = true;
                        loadDashboard();
                    }
                } else if (healthState == NotificationHelper.HealthState.AUTHENTICATION_REQUIRED) {
                    pageRequested = false;
                    showAuthenticationError(result.message);
                } else if (healthState == NotificationHelper.HealthState.OFFLINE) {
                    pageRequested = false;
                    showOffline(result.message);
                } else if (!pageRequested) {
                    showConnectionIssue(result.message);
                }
            });
        });
    }

    private void loadDashboard() {
        if (Config.ACCESS_TOKEN.isBlank()) {
            webView.loadUrl(Config.DASHBOARD_URL);
            return;
        }
        String cookie = Config.ACCESS_COOKIE + "=" + Uri.encode(Config.ACCESS_TOKEN)
            + "; Path=/; Secure; HttpOnly; SameSite=Strict";
        CookieManager.getInstance().setCookie(Config.BASE_URL, cookie, accepted -> {
            if (!accepted) {
                pageRequested = false;
                showConnectionIssue("O Android não conseguiu criar a sessão segura do painel");
                return;
            }
            CookieManager.getInstance().flush();
            webView.loadUrl(Config.DASHBOARD_URL);
        });
    }

    private boolean isTrustedUrl(String url) {
        return url.equals(Config.BASE_URL) || url.startsWith(Config.BASE_URL + "/");
    }

    private void showChecking() {
        offlineOverlay.setVisibility(View.VISIBLE);
        offlineBadge.setText(R.string.checking);
        offlineTitle.setText(R.string.connecting_title);
        offlineDetail.setText(R.string.connecting_detail);
        lastCheck.setVisibility(View.GONE);
        retryButton.setVisibility(View.GONE);
    }

    private void showOffline(String reason) {
        showProblem(R.string.offline_badge, R.string.offline_title, R.string.offline_detail, reason);
    }

    private void showConnectionIssue(String reason) {
        showProblem(R.string.connection_issue_badge, R.string.connection_issue_title, R.string.connection_issue_detail, reason);
    }

    private void showAuthenticationError(String reason) {
        showProblem(R.string.authentication_badge, R.string.authentication_title, R.string.authentication_detail, reason);
    }

    private void showProblem(int badgeResource, int titleResource, int detailResource, String reason) {
        offlineOverlay.setVisibility(View.VISIBLE);
        offlineBadge.setText(badgeResource);
        offlineTitle.setText(titleResource);
        String detail = getString(detailResource);
        if (reason != null && !reason.isBlank()) detail += "\n\nDetalhe: " + reason;
        offlineDetail.setText(detail);
        String time = DateFormat.getTimeInstance(DateFormat.SHORT).format(new Date());
        lastCheck.setText(getString(R.string.last_check, time));
        lastCheck.setVisibility(View.VISIBLE);
        retryButton.setVisibility(View.VISIBLE);
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 100);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        handler.removeCallbacks(foregroundHealthLoop);
        handler.postDelayed(foregroundHealthLoop, Config.FOREGROUND_CHECK_INTERVAL_MS);
    }

    @Override
    protected void onPause() {
        handler.removeCallbacks(foregroundHealthLoop);
        super.onPause();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleUpdateIntent(intent);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQUEST_UNKNOWN_SOURCES && UpdateManager.canRequestInstall(this)) {
            handleUpdateIntent(new Intent(this, MainActivity.class).setAction(UpdateManager.ACTION_INSTALL_UPDATE));
        }
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacks(foregroundHealthLoop);
        webView.destroy();
        executor.shutdownNow();
        super.onDestroy();
    }
}
