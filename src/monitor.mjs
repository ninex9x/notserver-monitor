import { spawn } from "node:child_process";

const SSH_OPTIONS = [
  "-o",
  "BatchMode=yes",
  "-o",
  "ConnectTimeout=8",
  "-o",
  "ServerAliveInterval=5",
  "-o",
  "ServerAliveCountMax=1",
];

const TARGET_PATTERN = /^[a-zA-Z0-9_.@:-]+$/;
const UNIT_PATTERN = /^[a-zA-Z0-9@_.:-]+\.service$/;

// Every command in this script is read-only. Section markers make the output
// deterministic without requiring software to be installed on the remote host.
export const REMOTE_STATUS_SCRIPT = String.raw`set -u

read -r _ cpu_user cpu_nice cpu_system cpu_idle cpu_iowait cpu_irq cpu_softirq cpu_steal _rest < /proc/stat
cpu_total_1=$((cpu_user + cpu_nice + cpu_system + cpu_idle + cpu_iowait + cpu_irq + cpu_softirq + cpu_steal))
cpu_idle_1=$((cpu_idle + cpu_iowait))
sleep 0.2
read -r _ cpu_user cpu_nice cpu_system cpu_idle cpu_iowait cpu_irq cpu_softirq cpu_steal _rest < /proc/stat
cpu_total_2=$((cpu_user + cpu_nice + cpu_system + cpu_idle + cpu_iowait + cpu_irq + cpu_softirq + cpu_steal))
cpu_idle_2=$((cpu_idle + cpu_iowait))
cpu_delta=$((cpu_total_2 - cpu_total_1))
idle_delta=$((cpu_idle_2 - cpu_idle_1))
if [ "$cpu_delta" -gt 0 ]; then
  cpu_percent=$(awk -v total="$cpu_delta" -v idle="$idle_delta" 'BEGIN { printf "%.1f", (total-idle)*100/total }')
else
  cpu_percent="0.0"
fi

mem_total_kb=$(awk '$1 == "MemTotal:" { print $2 }' /proc/meminfo)
mem_available_kb=$(awk '$1 == "MemAvailable:" { print $2 }' /proc/meminfo)
load_values=$(cut -d ' ' -f 1-3 /proc/loadavg)
uptime_seconds=$(cut -d '.' -f 1 /proc/uptime)
os_name=$(awk -F= '$1 == "PRETTY_NAME" { value=$2; gsub(/^"|"$/, "", value); print value }' /etc/os-release 2>/dev/null || true)
system_state=$(systemctl is-system-running 2>/dev/null || true)

echo '@@META@@'
printf 'hostname\t%s\n' "$(hostname)"
printf 'os\t%s\n' "$os_name"
printf 'kernel\t%s\n' "$(uname -sr)"
printf 'server_time\t%s\n' "$(date --iso-8601=seconds)"
printf 'uptime_seconds\t%s\n' "$uptime_seconds"
printf 'cpu_percent\t%s\n' "$cpu_percent"
printf 'memory_total_kb\t%s\n' "$mem_total_kb"
printf 'memory_available_kb\t%s\n' "$mem_available_kb"
printf 'load\t%s\n' "$load_values"
printf 'system_state\t%s\n' "$system_state"

echo '@@DISKS@@'
df -P -B1 -x tmpfs -x devtmpfs 2>/dev/null | tail -n +2 | awk '{ printf "%s\t%s\t%s\t%s\t%s\n", $1, $2, $3, $5, $6 }'

echo '@@SERVICES@@'
systemctl list-units --type=service --all --no-legend --plain --no-pager 2>/dev/null || true

echo '@@CONTAINERS@@'
docker ps -a --no-trunc --format '{{json .}}' 2>/dev/null || true

echo '@@CONTAINER_STATS@@'
docker stats --no-stream --format '{{json .}}' 2>/dev/null || true

echo '@@SERVICE_USAGE@@'
ps -ww -eo unit:96=,pcpu=,pmem=,rss=,comm= --no-headers 2>/dev/null | awk '$1 ~ /\.service$/ { printf "%s\t%s\t%s\t%s\t%s\n", $1, $2, $3, $4, $5 }' || true

echo '@@ERRORS@@'
journalctl --since '-1 hour' -p 0..3 --no-pager -n 60 -o short-iso 2>/dev/null || true
`;

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampPercent(value) {
  return Math.min(100, Math.max(0, number(value)));
}

function splitSections(output) {
  const sections = {};
  let current = null;

  for (const line of output.replace(/\r/g, "").split("\n")) {
    const marker = line.match(/^@@([A-Z_]+)@@$/);
    if (marker) {
      current = marker[1];
      sections[current] = [];
    } else if (current && line.trim()) {
      sections[current].push(line);
    }
  }

  return sections;
}

function parseMeta(lines = []) {
  return Object.fromEntries(
    lines.map((line) => {
      const separator = line.indexOf("\t");
      return separator === -1
        ? [line, ""]
        : [line.slice(0, separator), line.slice(separator + 1)];
    }),
  );
}

function parseService(line) {
  const match = line.match(/^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s*(.*)$/);
  if (!match) return null;

  const [, unit, load, active, sub, description] = match;
  let health = "unknown";
  if (active === "failed" || sub === "failed") health = "critical";
  else if (active === "active") health = "healthy";
  else if (active === "activating" || active === "deactivating") health = "warning";

  return {
    unit,
    name: unit.replace(/\.service$/, ""),
    load,
    active,
    sub,
    description: description || unit,
    health,
  };
}

function parseDockerJson(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function parseDockerLabels(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  return String(value).split(",").reduce((labels, entry) => {
    const separator = entry.indexOf("=");
    if (separator > 0) labels[entry.slice(0, separator)] = entry.slice(separator + 1);
    return labels;
  }, {});
}

function parseContainers(containerLines = [], statLines = []) {
  const stats = new Map(
    statLines
      .map(parseDockerJson)
      .filter(Boolean)
      .map((item) => [item.Name || item.Container, item]),
  );

  return containerLines
    .map(parseDockerJson)
    .filter(Boolean)
    .map((item) => {
      const name = item.Names || item.Name || "container";
      const status = item.Status || "desconhecido";
      const state = (item.State || "").toLowerCase();
      const stat = stats.get(name) || {};
      const labels = parseDockerLabels(item.Labels);
      const healthy = /\(healthy\)/i.test(status);
      const unhealthy = /\(unhealthy\)/i.test(status);
      const running = state === "running" || /^up\b/i.test(status);

      return {
        id: item.ID || "",
        name,
        image: item.Image || "",
        status,
        state: item.State || (running ? "running" : "stopped"),
        ports: item.Ports || "",
        composeProject: labels["com.docker.compose.project"] || "",
        composeService: labels["com.docker.compose.service"] || "",
        health: unhealthy ? "critical" : running ? (healthy || !/health/i.test(status) ? "healthy" : "warning") : "critical",
        cpuPercent: clampPercent(String(stat.CPUPerc || "0").replace("%", "")),
        memoryPercent: clampPercent(String(stat.MemPerc || "0").replace("%", "")),
        memoryUsage: stat.MemUsage || "",
      };
    });
}

function parseServiceUsage(lines = [], memoryTotal = 0) {
  const usageByUnit = new Map();
  for (const line of lines) {
    const [unit, cpuValue, memoryValue, rssValue, command] = line.split("\t");
    if (!unit?.endsWith(".service")) continue;
    const current = usageByUnit.get(unit) || {
      unit,
      name: unit.replace(/\.service$/, ""),
      cpuPercent: 0,
      memoryPercent: 0,
      memoryBytes: 0,
      processCount: 0,
      commands: new Set(),
    };
    current.cpuPercent += Math.max(0, number(cpuValue));
    current.memoryPercent += Math.max(0, number(memoryValue));
    current.memoryBytes += Math.max(0, number(rssValue)) * 1024;
    current.processCount += 1;
    if (command) current.commands.add(command);
    usageByUnit.set(unit, current);
  }

  return [...usageByUnit.values()].map((item) => ({
    ...item,
    cpuPercent: Number(item.cpuPercent.toFixed(1)),
    memoryPercent: memoryTotal ? clampPercent((item.memoryBytes / memoryTotal) * 100) : clampPercent(item.memoryPercent),
    commands: [...item.commands].slice(0, 5),
  })).sort((a, b) => (b.cpuPercent + b.memoryPercent) - (a.cpuPercent + a.memoryPercent));
}

function parseJournalLine(line, index) {
  const firstSpace = line.indexOf(" ");
  return {
    id: `journal-${index}`,
    timestamp: firstSpace > 0 ? line.slice(0, firstSpace) : "",
    message: firstSpace > 0 ? line.slice(firstSpace + 1) : line,
    raw: line,
    severity: "critical",
  };
}

function isJournalEntry(line) {
  const normalized = line.trim().toLowerCase();
  return normalized && normalized !== "-- no entries --" && normalized !== "no entries";
}

export function buildAlerts(snapshot) {
  const alerts = [];
  const add = (severity, code, title, detail) => alerts.push({ severity, code, title, detail });

  if (!snapshot.reachable) {
    add("critical", "server-unreachable", "Servidor inacessível", snapshot.error || "A conexão SSH não respondeu.");
    return alerts;
  }

  const failedServices = snapshot.services.filter((service) => service.health === "critical");
  if (failedServices.length) {
    add(
      "critical",
      "failed-services",
      `${failedServices.length} serviço${failedServices.length > 1 ? "s" : ""} com falha`,
      failedServices.map((service) => service.unit).join(", "),
    );
  }

  const failedContainers = snapshot.containers.filter((container) => container.health === "critical");
  if (failedContainers.length) {
    add(
      "critical",
      "failed-containers",
      `${failedContainers.length} contêiner${failedContainers.length > 1 ? "es" : ""} requer atenção`,
      failedContainers.map((container) => container.name).join(", "),
    );
  }

  for (const disk of snapshot.disks) {
    if (disk.usedPercent >= 95) {
      add("critical", `disk-${disk.mount}`, "Disco quase cheio", `${disk.mount} está em ${disk.usedPercent}% de uso.`);
    } else if (disk.usedPercent >= 85) {
      add("warning", `disk-${disk.mount}`, "Espaço em disco reduzido", `${disk.mount} está em ${disk.usedPercent}% de uso.`);
    }
  }

  if (snapshot.metrics.memoryPercent >= 95) {
    add("critical", "memory", "Memória em nível crítico", `${snapshot.metrics.memoryPercent.toFixed(1)}% em uso.`);
  } else if (snapshot.metrics.memoryPercent >= 85) {
    add("warning", "memory", "Uso elevado de memória", `${snapshot.metrics.memoryPercent.toFixed(1)}% em uso.`);
  }

  if (snapshot.metrics.cpuPercent >= 95) {
    add("critical", "cpu", "CPU em nível crítico", `${snapshot.metrics.cpuPercent.toFixed(1)}% em uso.`);
  } else if (snapshot.metrics.cpuPercent >= 85) {
    add("warning", "cpu", "Uso elevado de CPU", `${snapshot.metrics.cpuPercent.toFixed(1)}% em uso.`);
  }

  if (snapshot.errors.length) {
    add(
      "warning",
      "journal-errors",
      `${snapshot.errors.length} erro${snapshot.errors.length > 1 ? "s" : ""} no journal na última hora`,
      "Abra a seção de incidentes para ver os registros mais recentes.",
    );
  }

  return alerts;
}

export function parseRemoteStatus(output, target = "notserver") {
  const sections = splitSections(output);
  const meta = parseMeta(sections.META);
  const memoryTotal = number(meta.memory_total_kb) * 1024;
  const memoryAvailable = number(meta.memory_available_kb) * 1024;
  const memoryUsed = Math.max(0, memoryTotal - memoryAvailable);
  const loads = (meta.load || "0 0 0").split(/\s+/).map((value) => number(value));

  const disks = (sections.DISKS || []).map((line) => {
    const [filesystem, size, used, percent, ...mountParts] = line.split("\t");
    return {
      filesystem,
      size: number(size),
      used: number(used),
      usedPercent: clampPercent(String(percent || "0").replace("%", "")),
      mount: mountParts.join("\t") || "?",
    };
  });

  const snapshot = {
    target,
    reachable: true,
    collectedAt: new Date().toISOString(),
    serverTime: meta.server_time || null,
    hostname: meta.hostname || target,
    os: meta.os || "Linux",
    kernel: meta.kernel || "",
    systemState: meta.system_state || "unknown",
    uptimeSeconds: number(meta.uptime_seconds),
    metrics: {
      cpuPercent: clampPercent(meta.cpu_percent),
      memoryTotal,
      memoryUsed,
      memoryAvailable,
      memoryPercent: memoryTotal ? clampPercent((memoryUsed / memoryTotal) * 100) : 0,
      load1: loads[0] || 0,
      load5: loads[1] || 0,
      load15: loads[2] || 0,
    },
    disks,
    services: (sections.SERVICES || []).map(parseService).filter(Boolean),
    containers: parseContainers(sections.CONTAINERS, sections.CONTAINER_STATS),
    serviceUsage: parseServiceUsage(sections.SERVICE_USAGE, memoryTotal),
    errors: (sections.ERRORS || []).filter(isJournalEntry).map(parseJournalLine),
    alerts: [],
  };

  snapshot.alerts = buildAlerts(snapshot);
  snapshot.overall = snapshot.alerts.some((alert) => alert.severity === "critical")
    ? "critical"
    : snapshot.alerts.length
      ? "warning"
      : "healthy";

  return snapshot;
}

export function validateTarget(target) {
  if (!TARGET_PATTERN.test(target)) throw new Error("Destino SSH inválido.");
  return target;
}

export function validateUnit(unit) {
  if (!UNIT_PATTERN.test(unit)) throw new Error("Unidade systemd inválida.");
  return unit;
}

function runScriptProcess(command, args, script, timeoutMs, timeoutLabel) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(new Error(`Tempo limite de ${Math.round(timeoutMs / 1000)}s excedido ao consultar ${timeoutLabel}.`));
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || `SSH finalizado com código ${code}.`));
    });

    child.stdin.end(script);
  });
}

function runRemoteScript(target, script, timeoutMs = 15_000) {
  validateTarget(target);
  return runScriptProcess("ssh", [...SSH_OPTIONS, "--", target, "bash", "-s"], script, timeoutMs, target);
}

function runLocalScript(script, timeoutMs = 15_000) {
  return runScriptProcess("bash", ["-s"], script, timeoutMs, "o servidor local");
}

export async function collectStatus(target = "notserver", local = false) {
  const output = await (local ? runLocalScript(REMOTE_STATUS_SCRIPT) : runRemoteScript(target, REMOTE_STATUS_SCRIPT));
  return parseRemoteStatus(output, target);
}

export async function collectUnitLogs(target, requestedUnit, local = false) {
  const unit = validateUnit(requestedUnit);
  const script = `journalctl --since '-24 hours' -u '${unit}' -p 0..4 --no-pager -n 200 -o short-iso 2>/dev/null || true\n`;
  const output = await (local ? runLocalScript(script, 12_000) : runRemoteScript(target, script, 12_000));

  return {
    unit,
    collectedAt: new Date().toISOString(),
    lines: output
      .replace(/\r/g, "")
      .split("\n")
      .filter(isJournalEntry),
  };
}

export function offlineSnapshot(target, error) {
  const snapshot = {
    target,
    reachable: false,
    collectedAt: new Date().toISOString(),
    serverTime: null,
    hostname: target,
    os: "",
    kernel: "",
    systemState: "offline",
    uptimeSeconds: 0,
    metrics: {
      cpuPercent: 0,
      memoryTotal: 0,
      memoryUsed: 0,
      memoryAvailable: 0,
      memoryPercent: 0,
      load1: 0,
      load5: 0,
      load15: 0,
    },
    disks: [],
    services: [],
    containers: [],
    serviceUsage: [],
    errors: [],
    alerts: [],
    overall: "critical",
    error: error instanceof Error ? error.message : String(error),
  };
  snapshot.alerts = buildAlerts(snapshot);
  return snapshot;
}

export function demoSnapshot(target = "notserver") {
  const output = `@@META@@
hostname\tdemo-server
os\tUbuntu 24.04.3 LTS
kernel\tLinux 6.8.0-79-generic
server_time\t${new Date().toISOString()}
uptime_seconds\t493020
cpu_percent\t18.4
memory_total_kb\t16384000
memory_available_kb\t10240000
load\t0.34 0.48 0.41
system_state\trunning
@@DISKS@@
/dev/mapper/ubuntu--vg-ubuntu--lv\t103441707008\t32733118464\t34%\t/
/dev/sda2\t2040373248\t209543168\t11%\t/boot
@@SERVICES@@
cloudflared-monitor.service loaded active running Cloudflare Tunnel monitor
docker.service loaded active running Docker Application Container Engine
worker-demo.service loaded active running Example background worker
ssh.service loaded active running OpenBSD Secure Shell server
@@CONTAINERS@@
{"ID":"0a1","Image":"acme/web:latest","Names":"acme-web-1","Status":"Up 3 days (healthy)","State":"running","Ports":"3000/tcp","Labels":"com.docker.compose.project=acme,com.docker.compose.service=web"}
{"ID":"0a2","Image":"postgres:16-alpine","Names":"acme-db-1","Status":"Up 3 days (healthy)","State":"running","Ports":"5432/tcp","Labels":"com.docker.compose.project=acme,com.docker.compose.service=db"}
{"ID":"0a3","Image":"cloudflare/cloudflared:latest","Names":"edge-tunnel","Status":"Up 39 hours","State":"running","Ports":""}
@@CONTAINER_STATS@@
{"Name":"acme-web-1","CPUPerc":"0.35%","MemPerc":"2.20%","MemUsage":"181MiB / 8GiB"}
{"Name":"acme-db-1","CPUPerc":"1.22%","MemPerc":"4.80%","MemUsage":"393MiB / 8GiB"}
{"Name":"edge-tunnel","CPUPerc":"0.08%","MemPerc":"0.75%","MemUsage":"61MiB / 8GiB"}
@@SERVICE_USAGE@@
docker.service\t0.4\t1.8\t86000\tdockerd
worker-demo.service\t0.2\t2.1\t91532\tnode
cloudflared-monitor.service\t0.1\t0.7\t60356\tcloudflared
@@ERRORS@@`;
  return parseRemoteStatus(output, target);
}

export class Monitor {
  constructor({ target = "notserver", ttlMs = 8_000, demo = false, local = false } = {}) {
    this.target = local ? target : validateTarget(target);
    this.ttlMs = ttlMs;
    this.demo = demo;
    this.local = local;
    this.cached = null;
    this.pending = null;
  }

  async getSnapshot({ force = false } = {}) {
    const cacheIsFresh = this.cached && Date.now() - Date.parse(this.cached.collectedAt) < this.ttlMs;
    if (!force && cacheIsFresh) return this.cached;
    if (this.pending) return this.pending;

    this.pending = (this.demo ? Promise.resolve(demoSnapshot(this.target)) : collectStatus(this.target, this.local))
      .catch((error) => offlineSnapshot(this.target, error))
      .then((snapshot) => {
        this.cached = snapshot;
        return snapshot;
      })
      .finally(() => {
        this.pending = null;
      });

    return this.pending;
  }

  getUnitLogs(unit) {
    if (this.demo) {
      return Promise.resolve({
        unit: validateUnit(unit),
        collectedAt: new Date().toISOString(),
        lines: ["Nenhum erro encontrado nas últimas 24 horas."],
      });
    }
    return collectUnitLogs(this.target, unit, this.local);
  }
}
