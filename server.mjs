import { createReadStream, readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { accessCookie, requestToken, tokenMatches } from "./src/auth.mjs";
import { Monitor } from "./src/monitor.mjs";
import { loadUpdateRelease } from "./src/update.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(ROOT, "public");
const PORT = Number(process.env.PORT || 4242);
const HOST = process.env.HOST || "127.0.0.1";
const TARGET = process.env.NOTSERVER_SSH_TARGET || "notserver";
const DEMO = process.env.MONITOR_DEMO === "true";
const LOCAL = process.env.MONITOR_LOCAL === "true";
const PUBLIC_ORIGIN = String(process.env.MONITOR_PUBLIC_ORIGIN || "").replace(/\/$/, "");
const UPDATE_DIR = process.env.MONITOR_UPDATE_DIR || join(ROOT, "updates");
const ACCESS_TOKEN = loadAccessToken();
const monitor = new Monitor({ target: TARGET, demo: DEMO, local: LOCAL });

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function setSecurityHeaders(response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Strict-Transport-Security", "max-age=31536000");
  response.setHeader("Permissions-Policy", "camera=(), geolocation=(), microphone=()");
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  );
}

function json(response, status, body) {
  setSecurityHeaders(response);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(body));
}

function loadAccessToken() {
  const inlineToken = String(process.env.MONITOR_ACCESS_TOKEN || "").trim();
  if (inlineToken) return inlineToken;

  const tokenFile = String(process.env.MONITOR_ACCESS_TOKEN_FILE || "").trim();
  if (!tokenFile) return "";
  const fileToken = readFileSync(tokenFile, "utf8").trim();
  if (!fileToken) throw new Error(`O arquivo de token está vazio: ${tokenFile}`);
  return fileToken;
}

function unauthorized(response, apiRequest) {
  setSecurityHeaders(response);
  const headers = {
    "Cache-Control": "no-store",
    "WWW-Authenticate": 'Bearer realm="notserver-monitor"',
  };
  if (apiRequest) {
    response.writeHead(401, { ...headers, "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: "Autenticação necessária." }));
    return;
  }
  response.writeHead(401, { ...headers, "Content-Type": "text/plain; charset=utf-8" });
  response.end("Autenticação necessária. Abra o painel pelo aplicativo autorizado.");
}

async function serveStatic(pathname, response) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const safeRelative = normalize(requested).replace(/^(\.\.(\/|\\|$))+/, "").replace(/^[/\\]+/, "");
  const filePath = join(PUBLIC_DIR, safeRelative);
  if (!filePath.startsWith(`${PUBLIC_DIR}/`)) {
    json(response, 403, { error: "Acesso negado." });
    return;
  }

  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error("Not a file");
    setSecurityHeaders(response);
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    createReadStream(filePath).pipe(response);
  } catch {
    json(response, 404, { error: "Arquivo não encontrado." });
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

  if (PUBLIC_ORIGIN && String(request.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "http") {
    const secureUrl = new URL(`${url.pathname}${url.search}`, PUBLIC_ORIGIN);
    secureUrl.searchParams.delete("token");
    setSecurityHeaders(response);
    response.writeHead(308, { Location: secureUrl.toString(), "Cache-Control": "no-store" });
    response.end();
    return;
  }

  if (request.method !== "GET") {
    json(response, 405, { error: "Método não permitido." });
    return;
  }

  if (ACCESS_TOKEN && url.pathname === "/" && url.searchParams.has("token")) {
    if (!tokenMatches(url.searchParams.get("token"), ACCESS_TOKEN)) {
      unauthorized(response, false);
      return;
    }
    setSecurityHeaders(response);
    response.writeHead(303, {
      "Cache-Control": "no-store",
      "Set-Cookie": accessCookie(ACCESS_TOKEN),
      Location: "/",
    });
    response.end();
    return;
  }

  if (ACCESS_TOKEN && !tokenMatches(requestToken(request), ACCESS_TOKEN)) {
    unauthorized(response, url.pathname.startsWith("/api/"));
    return;
  }

  if (url.pathname === "/api/app-update" || url.pathname === "/api/app-update/apk") {
    try {
      const release = await loadUpdateRelease(UPDATE_DIR);
      if (url.pathname === "/api/app-update") {
        json(response, 200, release.metadata);
        return;
      }
      setSecurityHeaders(response);
      response.writeHead(200, {
        "Content-Type": "application/vnd.android.package-archive",
        "Content-Disposition": 'attachment; filename="notserver-monitor.apk"',
        "Content-Length": String(release.metadata.size),
        "Cache-Control": "private, no-store",
      });
      createReadStream(release.apkPath).on("error", () => response.destroy()).pipe(response);
    } catch (error) {
      json(response, 404, { error: "Nenhuma atualização está disponível." });
    }
    return;
  }

  if (url.pathname === "/api/status") {
    const snapshot = await monitor.getSnapshot({ force: url.searchParams.get("refresh") === "1" });
    json(response, 200, snapshot);
    return;
  }

  if (url.pathname === "/api/health") {
    const snapshot = await monitor.getSnapshot();
    json(response, snapshot.reachable ? 200 : 503, {
      status: snapshot.overall,
      reachable: snapshot.reachable,
      target: snapshot.target,
      collectedAt: snapshot.collectedAt,
    });
    return;
  }

  if (url.pathname === "/api/logs") {
    const unit = url.searchParams.get("unit") || "";
    try {
      json(response, 200, await monitor.getUnitLogs(unit));
    } catch (error) {
      json(response, 400, { error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  await serveStatic(url.pathname, response);
});

server.listen(PORT, HOST, () => {
  const mode = DEMO ? "demo" : LOCAL ? `local → ${TARGET}` : `SSH → ${TARGET}`;
  const protection = ACCESS_TOKEN ? "token obrigatório" : "sem autenticação";
  console.log(`Notserver Monitor disponível em http://${HOST}:${PORT} (${mode}; ${protection})`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
