package com.tales.notservermonitor;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public final class HealthChecker {
    public enum FailureType {
        NONE,
        AUTHENTICATION,
        SERVER_UNREACHABLE,
        TRANSIENT
    }

    public static final class Result {
        public final boolean online;
        public final int statusCode;
        public final String message;
        public final FailureType failureType;

        Result(boolean online, int statusCode, String message, FailureType failureType) {
            this.online = online;
            this.statusCode = statusCode;
            this.message = message;
            this.failureType = failureType;
        }
    }

    private HealthChecker() {}

    public static Result check() {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(Config.HEALTH_URL).openConnection();
            connection.setRequestMethod("GET");
            connection.setConnectTimeout(10_000);
            // /api/health may wait for a full monitor collection, whose backend
            // timeout is 15 seconds. Leave enough headroom for the tunnel too.
            connection.setReadTimeout(20_000);
            connection.setUseCaches(false);
            connection.setRequestProperty("Accept", "application/json");
            if (!Config.ACCESS_TOKEN.isBlank()) {
                connection.setRequestProperty("Authorization", "Bearer " + Config.ACCESS_TOKEN);
            }

            int statusCode = connection.getResponseCode();
            InputStream stream = statusCode >= 200 && statusCode < 400
                ? connection.getInputStream()
                : connection.getErrorStream();
            String body = readBody(stream);
            JSONObject payload = parseJson(body);

            if (statusCode == 200 && payload != null && payload.optBoolean("reachable", false)) {
                return new Result(true, statusCode, "Servidor operacional", FailureType.NONE);
            }
            if (statusCode == 401 || statusCode == 403) {
                return new Result(
                    false,
                    statusCode,
                    "O acesso à API foi recusado. Instale a versão mais recente do aplicativo",
                    FailureType.AUTHENTICATION
                );
            }
            if (payload != null && payload.has("reachable") && !payload.optBoolean("reachable", true)) {
                return new Result(
                    false,
                    statusCode,
                    "A API confirmou que o servidor monitorado não está acessível",
                    FailureType.SERVER_UNREACHABLE
                );
            }

            String message = statusCode > 0
                ? "Falha temporária ao consultar a API (HTTP " + statusCode + ")"
                : "Falha temporária ao consultar a API";
            return new Result(false, statusCode, message, FailureType.TRANSIENT);
        } catch (Exception error) {
            String message = error.getMessage();
            return new Result(
                false,
                0,
                message == null || message.isBlank() ? "A API não respondeu" : message,
                FailureType.TRANSIENT
            );
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static JSONObject parseJson(String body) {
        try {
            return new JSONObject(body);
        } catch (Exception ignored) {
            return null;
        }
    }

    private static String readBody(InputStream stream) throws Exception {
        if (stream == null) return "{}";
        StringBuilder body = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) body.append(line);
        }
        return body.toString();
    }
}
