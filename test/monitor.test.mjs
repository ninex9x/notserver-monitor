import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAlerts,
  demoSnapshot,
  offlineSnapshot,
  parseRemoteStatus,
  validateTarget,
  validateUnit,
} from "../src/monitor.mjs";

test("parseia métricas, serviços, Docker e journal", () => {
  const output = `@@META@@
hostname\tserver-01
os\tUbuntu 24.04 LTS
kernel\tLinux 6.8.0
server_time\t2026-08-31T12:00:00-03:00
uptime_seconds\t90061
cpu_percent\t22.5
memory_total_kb\t1000
memory_available_kb\t250
load\t0.20 0.30 0.40
system_state\tdegraded
@@DISKS@@
/dev/sda1\t1000\t900\t90%\t/
@@SERVICES@@
api.service loaded failed failed Minha API
ssh.service loaded active running OpenSSH
@@CONTAINERS@@
{"ID":"abc","Image":"api:latest","Names":"api","Status":"Up 2 hours (unhealthy)","State":"running","Ports":"3000/tcp","Labels":"com.docker.compose.project=novo-projeto,com.docker.compose.service=api"}
@@CONTAINER_STATS@@
{"Name":"api","CPUPerc":"4.20%","MemPerc":"12.00%","MemUsage":"120MiB / 1GiB"}
@@SERVICE_USAGE@@
api.service\t3.50\t8.00\t80\tapi
api.service\t0.50\t2.00\t20\tworker
ssh.service\t0.10\t1.00\t10\tsshd
@@ERRORS@@
2026-08-31T11:59:00-03:00 server api[1]: fatal error`;

  const snapshot = parseRemoteStatus(output, "server-test");
  assert.equal(snapshot.hostname, "server-01");
  assert.equal(snapshot.uptimeSeconds, 90061);
  assert.equal(snapshot.metrics.cpuPercent, 22.5);
  assert.equal(snapshot.metrics.memoryPercent, 75);
  assert.equal(snapshot.disks[0].usedPercent, 90);
  assert.equal(snapshot.services[0].health, "critical");
  assert.equal(snapshot.containers[0].health, "critical");
  assert.equal(snapshot.containers[0].cpuPercent, 4.2);
  assert.equal(snapshot.containers[0].composeProject, "novo-projeto");
  assert.equal(snapshot.containers[0].composeService, "api");
  assert.equal(snapshot.serviceUsage[0].unit, "api.service");
  assert.equal(snapshot.serviceUsage[0].cpuPercent, 4);
  assert.equal(snapshot.serviceUsage[0].processCount, 2);
  assert.deepEqual(snapshot.serviceUsage[0].commands, ["api", "worker"]);
  assert.equal(snapshot.errors.length, 1);
  assert.equal(snapshot.overall, "critical");
  assert.ok(snapshot.alerts.some((alert) => alert.code === "failed-services"));
  assert.ok(snapshot.alerts.some((alert) => alert.code === "disk-/"));
});

test("gera estado saudável para a amostra de demonstração", () => {
  const snapshot = demoSnapshot();
  assert.equal(snapshot.reachable, true);
  assert.equal(snapshot.overall, "healthy");
  assert.equal(snapshot.alerts.length, 0);
  assert.equal(snapshot.containers.length, 3);
});

test("não transforma a mensagem de journal vazio em incidente", () => {
  const output = `@@META@@
hostname\tserver-01
memory_total_kb\t1000
memory_available_kb\t900
@@DISKS@@
@@SERVICES@@
@@CONTAINERS@@
@@CONTAINER_STATS@@
@@SERVICE_USAGE@@
@@ERRORS@@
-- No entries --`;
  const snapshot = parseRemoteStatus(output);
  assert.equal(snapshot.errors.length, 0);
  assert.equal(snapshot.alerts.length, 0);
  assert.equal(snapshot.overall, "healthy");
});

test("prioriza alerta de servidor inacessível", () => {
  const snapshot = offlineSnapshot("notserver", new Error("timeout"));
  assert.equal(snapshot.alerts.length, 1);
  assert.equal(snapshot.alerts[0].code, "server-unreachable");
  assert.equal(snapshot.overall, "critical");
});

test("alerta para CPU e memória elevadas", () => {
  const snapshot = demoSnapshot();
  snapshot.metrics.cpuPercent = 96;
  snapshot.metrics.memoryPercent = 88;
  const alerts = buildAlerts(snapshot);
  assert.ok(alerts.some((alert) => alert.code === "cpu" && alert.severity === "critical"));
  assert.ok(alerts.some((alert) => alert.code === "memory" && alert.severity === "warning"));
});

test("valida destino SSH e unidade systemd", () => {
  assert.equal(validateTarget("monitor@192.0.2.10"), "monitor@192.0.2.10");
  assert.equal(validateUnit("example-worker.service"), "example-worker.service");
  assert.throws(() => validateTarget("notserver; reboot"), /inválido/);
  assert.throws(() => validateUnit("ssh.service; reboot"), /inválida/);
  assert.throws(() => validateUnit("../../../etc/passwd"), /inválida/);
});
