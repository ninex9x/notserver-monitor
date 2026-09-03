const $ = (selector) => document.querySelector(selector);

const el = {
  alertBanner: $("#alert-banner"), alertDetail: $("#alert-detail"), alertTitle: $("#alert-title"),
  availabilitySpark: $("#availability-spark"), availabilityValue: $("#availability-value"),
  closeDialog: $("#close-dialog"), containerList: $("#container-list"), containersRunning: $("#containers-running"),
  containerCatalogView: $("#container-catalog-view"), containerDetailView: $("#container-detail-view"), containerGroupList: $("#container-group-list"),
  containerBack: $("#container-back"), containerGroupTitle: $("#container-group-title"), containerPanelTitle: $("#container-panel-title"),
  containerPanelDescription: $("#container-panel-description"), containerScreenEyebrow: $("#container-screen-eyebrow"),
  containerScreenTitle: $("#container-screen-title"), containerScreenDescription: $("#container-screen-description"), containersScreenTotalLabel: $("#containers-screen-total-label"),
  copyButton: $("#copy-button"), cpuSpark: $("#cpu-spark"), cpuState: $("#cpu-state"), cpuValue: $("#cpu-value"),
  diskMount: $("#disk-mount"), diskSpark: $("#disk-spark"), diskState: $("#disk-state"), diskUsed: $("#disk-used"), diskValue: $("#disk-value"),
  errorDonut: $("#error-donut"), failedContainerCount: $("#failed-container-count"), failedServiceCount: $("#failed-service-count"),
  footerSystem: $("#footer-system"), heroHost: $("#hero-host"), incidentCount: $("#incident-count"), incidentList: $("#incident-list"),
  issueFilter: $("#issue-filter"), journalErrorCount: $("#journal-error-count"), lastUpdate: $("#last-update"),
  legendCpu: $("#legend-cpu"), legendDisk: $("#legend-disk"), legendMemory: $("#legend-memory"), liveToggle: $("#live-toggle"),
  loadValue: $("#load-value"), logContent: $("#log-content"), logDialog: $("#log-dialog"), logTitle: $("#log-title"),
  memorySpark: $("#memory-spark"), memoryState: $("#memory-state"), memoryTotal: $("#memory-total"), memoryUsed: $("#memory-used"), memoryValue: $("#memory-value"),
  overviewAppList: $("#overview-app-list"), overviewAppSummary: $("#overview-app-summary"),
  overviewAttentionList: $("#overview-attention-list"), overviewConsumerList: $("#overview-consumer-list"), overviewConsumerSummary: $("#overview-consumer-summary"),
  overviewFailedServices: $("#overview-failed-services"), overviewFailedContainers: $("#overview-failed-containers"), overviewJournalErrors: $("#overview-journal-errors"),
  overallChip: $("#overall-chip"), printButton: $("#print-button"), refreshButton: $("#refresh-button"), refreshCountdown: $("#refresh-countdown"),
  resourceCpu: $("#resource-cpu"), resourceDisk: $("#resource-disk"), resourceMemory: $("#resource-memory"),
  serverDescription: $("#server-description"), serviceFilter: $("#service-filter"), serviceList: $("#service-list"), serviceSearch: $("#service-search"),
  serviceCatalogView: $("#service-catalog-view"), serviceDetailView: $("#service-detail-view"), serviceGroupList: $("#service-group-list"),
  serviceBack: $("#service-back"), serviceGroupTitle: $("#service-group-title"), componentPanelTitle: $("#component-panel-title"),
  componentPanelDescription: $("#component-panel-description"), serviceScreenEyebrow: $("#service-screen-eyebrow"),
  serviceScreenTitle: $("#service-screen-title"), serviceScreenDescription: $("#service-screen-description"), servicesScreenTotalLabel: $("#services-screen-total-label"),
  servicesFailed: $("#services-failed"), servicesRunning: $("#services-running"), servicesState: $("#services-state"),
  servicesScreenTotal: $("#services-screen-total"), containersScreenTotal: $("#containers-screen-total"),
  navServicesCount: $("#nav-services-count"), navContainersCount: $("#nav-containers-count"), navIncidentsCount: $("#nav-incidents-count"),
  statusOrb: $("#status-orb"), timeEnd: $("#time-end"), timeMiddle: $("#time-middle"), timeStart: $("#time-start"), toast: $("#toast"), uptime: $("#uptime"),
};

const HISTORY_KEY = "notserver-monitor-history-v2";
const SCREEN_LABELS = { overview: "Visão geral", services: "Serviços", containers: "Contêineres", incidents: "Incidentes" };
const SERVICE_GROUP_DEFINITIONS = [
  { id: "infraestrutura", name: "Infraestrutura", eyebrow: "Servidor", description: "Docker, containerd e acesso SSH.", service: /^(docker|containerd|ssh)\.service$/, prefixes: [] },
  { id: "systemd", name: "Todas as unidades", eyebrow: "Sistema operacional", description: "Inventário completo das unidades systemd do servidor.", allServices: true, prefixes: [] },
];
const DOCKER_GROUP_DEFINITIONS = [
  { id: "todos", name: "Todos os contêineres", eyebrow: "Inventário Docker", description: "Todos os contêineres encontrados neste servidor.", allContainers: true, prefixes: [] },
];
const state = { snapshot: null, loading: false, countdown: 15, live: true, onlyIssues: false, currentScreen: "overview", currentGroup: null, history: loadHistory() };

function definitionsForScreen(screen) {
  const base = screen === "services" ? SERVICE_GROUP_DEFINITIONS : screen === "containers" ? DOCKER_GROUP_DEFINITIONS : [];
  if (!base.length || !state.snapshot) return base;
  const inventory = base.find((definition) => definition.allServices || definition.allContainers);
  const known = base.filter((definition) => definition !== inventory);
  return [...known, ...dynamicProjectDefinitions(state.snapshot, known), inventory].filter(Boolean);
}

function routeFromHash() {
  return normalizeRoute(location.hash);
}

function normalizeRoute(route) {
  const raw = typeof route === "object" && route ? `${route.screen || "overview"}/${route.group || ""}` : String(route || "overview");
  const [requestedScreen, requestedGroup] = raw.replace(/^#/, "").split("/");
  const screen = Object.hasOwn(SCREEN_LABELS, requestedScreen) ? requestedScreen : "overview";
  const validGroup = definitionsForScreen(screen).some((group) => group.id === requestedGroup)
    || (!state.snapshot && /^compose-[a-z0-9_-]+$/.test(requestedGroup || ""));
  return { screen, group: validGroup ? requestedGroup : null };
}

function updateDocumentTitle() {
  const hostname = state.snapshot?.hostname || state.snapshot?.target || "notserver";
  const group = definitionsForScreen(state.currentScreen).find((item) => item.id === state.currentGroup);
  document.title = `${group?.name || SCREEN_LABELS[state.currentScreen]} · ${hostname}`;
}

function showScreen(route, updateHistory = true) {
  const { screen: next, group } = normalizeRoute(route);
  const groupChanged = state.currentGroup !== group;
  state.currentScreen = next;
  state.currentGroup = group;
  if (groupChanged && el.serviceSearch) el.serviceSearch.value = "";
  document.querySelectorAll("[data-screen-panel]").forEach((panel) => panel.classList.toggle("active", panel.dataset.screenPanel === next));
  let activeButton = null;
  document.querySelectorAll("[data-screen]").forEach((button) => {
    const active = button.dataset.screen === next;
    button.classList.toggle("active", active);
    button.setAttribute("aria-current", active ? "page" : "false");
    if (active) activeButton = button;
  });
  const filterVisible = (next === "services" || next === "containers") && Boolean(group);
  el.issueFilter.hidden = !filterVisible;
  $(".control-bar").classList.toggle("filter-hidden", !filterVisible);
  const routeHash = `#${next}${group ? `/${group}` : ""}`;
  if (updateHistory && location.hash !== routeHash) history.pushState({ screen: next, group }, "", routeHash);
  if (activeButton) {
    const navigation = activeButton.parentElement;
    navigation.scrollTo({ left: activeButton.offsetLeft - (navigation.clientWidth - activeButton.offsetWidth) / 2, behavior: "auto" });
  }
  if (state.snapshot && next === "services") renderServices();
  if (state.snapshot && next === "containers") renderContainers();
  updateDocumentTitle();
  window.scrollTo({ top: 0, behavior: "auto" });
}

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function loadHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    const cutoff = Date.now() - 60 * 60 * 1000;
    return Array.isArray(parsed) ? parsed.filter((item) => Number(item.time) >= cutoff).slice(-240) : [];
  } catch { return []; }
}

function saveHistory() {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history)); } catch { /* storage is optional */ }
}

function number(value) { return Number.isFinite(Number(value)) ? Number(value) : 0; }
function percent(value) { return `${number(value).toFixed(1).replace(".0", "")}%`; }

function formatBytes(bytes) {
  const value = number(bytes);
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const scaled = value / 1024 ** exponent;
  return `${scaled >= 10 || exponent === 0 ? scaled.toFixed(0) : scaled.toFixed(1)} ${units[exponent]}`;
}

function formatUptime(seconds) {
  const total = Math.max(0, Math.floor(number(seconds)));
  const days = Math.floor(total / 86400), hours = Math.floor((total % 86400) / 3600), minutes = Math.floor((total % 3600) / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes} min`;
}

function formatTime(value, includeSeconds = true) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", ...(includeSeconds ? { second: "2-digit" } : {}) }).format(date);
}

function formatLogTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "Agora";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}

function metricHealth(value) { return value >= 95 ? "critical" : value >= 85 ? "warning" : "healthy"; }
function healthLabel(health) { return health === "critical" ? "Crítico" : health === "warning" ? "Atenção" : "Normal"; }
function overallLabel(snapshot) {
  if (!snapshot.reachable) return "Sem conexão";
  if (snapshot.overall === "critical") return "Ação necessária";
  if (snapshot.overall === "warning") return "Requer atenção";
  return "Tudo operacional";
}

function setStatusClass(element, value) {
  element.classList.remove("healthy", "warning", "critical", "loading");
  element.classList.add(value);
}

function updateMetric(value, valueElement, stateElement) {
  const health = metricHealth(value);
  valueElement.textContent = number(value).toFixed(1).replace(".0", "");
  setStatusClass(stateElement, health);
  stateElement.textContent = healthLabel(health);
}

function updateAvailability(value) {
  const health = value < 90 ? "critical" : value < 99 ? "warning" : "healthy";
  el.availabilityValue.textContent = number(value).toFixed(1).replace(".0", "");
  setStatusClass(el.servicesState, health);
  el.servicesState.textContent = healthLabel(health);
}

function pathFor(values, width, height, padding = 2) {
  const samples = values.length > 1 ? values : [values[0] || 0, values[0] || 0];
  return samples.map((value, index) => {
    const x = (index / (samples.length - 1)) * width;
    const y = padding + (100 - Math.min(100, Math.max(0, number(value)))) * ((height - padding * 2) / 100);
    return `${index ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ");
}

function renderMiniChart(element, values) {
  element.innerHTML = `<path d="${pathFor(values.slice(-30), 360, 46, 2)}" />`;
}

function recordHistory(snapshot, disk, availability) {
  if (!snapshot.reachable) return;
  const timestamp = Date.parse(snapshot.collectedAt) || Date.now();
  const last = state.history.at(-1);
  if (last && last.source === snapshot.collectedAt) return;
  state.history.push({ time: timestamp, source: snapshot.collectedAt, cpu: snapshot.metrics.cpuPercent, memory: snapshot.metrics.memoryPercent, disk: disk.usedPercent, availability });
  const cutoff = Date.now() - 60 * 60 * 1000;
  state.history = state.history.filter((item) => item.time >= cutoff).slice(-240);
  saveHistory();
}

function renderHistory() {
  const history = state.history;
  const cpu = history.map((item) => item.cpu), memory = history.map((item) => item.memory), disk = history.map((item) => item.disk), availability = history.map((item) => item.availability);
  renderMiniChart(el.cpuSpark, cpu);
  renderMiniChart(el.memorySpark, memory);
  renderMiniChart(el.diskSpark, disk);
  renderMiniChart(el.availabilitySpark, availability);
  el.resourceCpu.setAttribute("d", pathFor(cpu, 1200, 270, 10));
  el.resourceMemory.setAttribute("d", pathFor(memory, 1200, 270, 10));
  el.resourceDisk.setAttribute("d", pathFor(disk, 1200, 270, 10));
  const first = history[0], middle = history[Math.floor((history.length - 1) / 2)], last = history.at(-1);
  el.timeStart.textContent = first ? formatTime(first.time, false) : "Agora";
  el.timeMiddle.textContent = middle && history.length > 2 ? formatTime(middle.time, false) : "—";
  el.timeEnd.textContent = last ? formatTime(last.time, false) : "Agora";
}

function friendlyComponentName(value, definition) {
  let name = String(value || "").replace(/\.service$/, "");
  for (const prefix of definition.prefixes) {
    if (name.startsWith(prefix)) { name = name.slice(prefix.length); break; }
  }
  name = name.replace(/-1$/, "");
  const labels = { api: "API", app: "Aplicação", db: "Banco de dados", gateway: "Gateway", logger: "Logger", nginx: "Nginx", redis: "Redis", web: "Web", bridge: "Bridge WhatsApp" };
  return labels[name] || name.split("-").map((part) => labels[part] || `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(" ");
}

function containerMatches(definition, container) {
  if (definition.allContainers) return true;
  if (definition.composeProject) return container.composeProject === definition.composeProject;
  return Boolean(definition.container?.test(container.name));
}

function projectDisplayName(project) {
  return project.split(/[-_]+/).filter(Boolean).map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(" ");
}

function dynamicProjectDefinitions(snapshot, knownDefinitions) {
  const containers = snapshot.containers || [];
  const projects = [...new Set(containers.map((container) => container.composeProject).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  return projects.filter((project) => {
    const projectContainers = containers.filter((container) => container.composeProject === project);
    return projectContainers.some((container) => !knownDefinitions.some((definition) => !definition.allContainers && containerMatches(definition, container)));
  }).map((project) => ({
    id: `compose-${project.toLowerCase().replace(/[^a-z0-9_-]+/g, "-")}`,
    name: projectDisplayName(project),
    eyebrow: "Docker Compose",
    description: "Projeto detectado automaticamente no servidor.",
    composeProject: project,
    prefixes: [`${project}-`, `${project}_`],
  }));
}

function componentsFor(definition, snapshot) {
  const services = (snapshot.services || [])
    .filter((service) => definition.allServices || definition.service?.test(service.unit))
    .map((service) => ({
      kind: "systemd", key: service.unit, unit: service.unit,
      name: friendlyComponentName(service.name, definition), sourceName: service.unit,
      description: service.description, status: service.sub, health: service.health,
      running: service.active === "active", activeLabel: service.active,
    }));
  const containers = definition.allServices ? [] : (snapshot.containers || [])
    .filter((container) => containerMatches(definition, container))
    .map((container) => ({
      kind: "docker", key: container.id || container.name, unit: null,
      name: friendlyComponentName(container.name, definition), sourceName: container.name,
      description: container.image, status: container.status, health: container.health,
      running: container.health !== "critical" && /^up\b/i.test(container.status || ""),
      activeLabel: /^up\b/i.test(container.status || "") ? "ativo" : "parado",
    }));
  return [...services, ...containers].sort((a, b) => {
    const healthOrder = (item) => item.health === "critical" ? 0 : item.running ? 1 : 2;
    return healthOrder(a) - healthOrder(b) || a.name.localeCompare(b.name, "pt-BR");
  });
}

function serviceGroups(snapshot) {
  return definitionsForScreen("services").map((definition) => {
    const components = componentsFor(definition, snapshot);
    const health = components.some((component) => component.health === "critical") ? "critical"
      : components.some((component) => component.health === "warning") ? "warning" : "healthy";
    return { ...definition, components, health, running: components.filter((component) => component.running).length };
  }).filter((group) => group.components.length);
}

function dockerGroups(snapshot) {
  return definitionsForScreen("containers").map((definition) => {
    const containers = (snapshot.containers || []).filter((container) => containerMatches(definition, container));
    const components = componentsFor(definition, snapshot);
    const health = containers.some((container) => container.health === "critical") ? "critical"
      : containers.some((container) => container.health === "warning") ? "warning" : "healthy";
    return { ...definition, containers, components, health, running: components.filter((component) => component.running).length };
  }).filter((group) => group.containers.length);
}

function groupHealthLabel(health) {
  return health === "critical" ? "Com falha" : health === "warning" ? "Atenção" : "Operacional";
}

function groupCardsMarkup(groups, dataAttribute) {
  return groups.map((group) => {
    const preview = group.components.slice(0, 4).map((component) => `<div class="group-component">
      <i class="status-dot ${escapeHtml(component.health)}"></i>
      <span>${escapeHtml(component.name)}</span>
      <b>${component.kind === "docker" ? "Docker" : "systemd"}</b>
    </div>`).join("");
    const remaining = group.components.length - 4;
    return `<button class="panel group-card" type="button" ${dataAttribute}="${escapeHtml(group.id)}" aria-label="Abrir componentes de ${escapeHtml(group.name)}">
      <span class="group-card-head">
        <span class="group-title"><strong>${escapeHtml(group.name)}</strong><small>${escapeHtml(group.eyebrow)} · ${escapeHtml(group.description)}</small></span>
        <span class="group-health ${escapeHtml(group.health)}">${groupHealthLabel(group.health)}</span>
      </span>
      <span class="group-components">${preview}${remaining > 0 ? `<span class="group-more">+ ${remaining} componente${remaining === 1 ? "" : "s"}</span>` : ""}</span>
      <span class="group-card-foot"><span><strong>${group.running}</strong> de ${group.components.length} ativos</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></span>
    </button>`;
  }).join("");
}

function renderServiceCatalog(groups) {
  el.serviceGroupList.innerHTML = groupCardsMarkup(groups, "data-service-group");
}

function renderComponentRows(group) {
  const query = el.serviceSearch.value.trim().toLowerCase();
  const filter = el.serviceFilter.value;
  let components = [...group.components];
  if (state.onlyIssues || filter === "failed") components = components.filter((component) => component.health === "critical");
  else if (filter === "active") components = components.filter((component) => component.running);
  else if (filter === "systemd" || filter === "docker") components = components.filter((component) => component.kind === filter);
  if (query) components = components.filter((component) => `${component.name} ${component.sourceName} ${component.description}`.toLowerCase().includes(query));

  if (!components.length) {
    el.serviceList.innerHTML = `<div class="empty-panel"><strong>Nenhum componente encontrado</strong><span>${state.onlyIssues ? "Nenhuma falha detectada nesta aplicação." : "Altere o filtro ou a busca."}</span></div>`;
    return;
  }
  el.serviceList.innerHTML = components.map((component) => `<div class="service-row">
    <div class="service-identity"><i class="status-dot ${escapeHtml(component.health)}"></i><div class="service-copy"><strong>${escapeHtml(component.name)}</strong><small>${escapeHtml(component.sourceName)}</small></div></div>
    <span class="service-description" title="${escapeHtml(component.description)}">${escapeHtml(component.description)}</span>
    <span class="service-health"><b class="${escapeHtml(component.health)}">${escapeHtml(component.activeLabel)}</b>${escapeHtml(component.status)}</span>
    ${component.unit ? `<button class="log-button" type="button" data-unit="${escapeHtml(component.unit)}" title="Ver logs" aria-label="Ver logs de ${escapeHtml(component.name)}"><svg viewBox="0 0 24 24"><path d="M5 4h14v16H5V4Zm2 3v2h7V7H7Zm0 4v2h10v-2H7Zm0 4v2h8v-2H7Z"/></svg></button>` : `<span class="component-kind">Docker</span>`}
  </div>`).join("");
}

function renderServices() {
  if (!state.snapshot) return;
  const groups = serviceGroups(state.snapshot);
  const group = groups.find((item) => item.id === state.currentGroup);
  el.servicesScreenTotal.textContent = String(groups.length);
  el.navServicesCount.textContent = String(groups.length);
  el.navServicesCount.classList.toggle("has-alert", groups.some((item) => item.health === "critical"));

  el.serviceCatalogView.hidden = Boolean(group);
  el.serviceDetailView.hidden = !group;
  if (!group) {
    el.serviceScreenEyebrow.textContent = "CATÁLOGO";
    el.serviceScreenTitle.textContent = "Serviços";
    el.serviceScreenDescription.textContent = "Aplicações e infraestrutura organizadas por produto.";
    el.servicesScreenTotalLabel.textContent = "grupos monitorados";
    renderServiceCatalog(groups);
    return;
  }
  el.serviceScreenEyebrow.textContent = `SERVIÇOS / ${group.eyebrow.toUpperCase()}`;
  el.serviceScreenTitle.textContent = group.name;
  el.serviceScreenDescription.textContent = group.description;
  el.servicesScreenTotal.textContent = String(group.components.length);
  el.servicesScreenTotalLabel.textContent = group.components.length === 1 ? "componente monitorado" : "componentes monitorados";
  el.serviceGroupTitle.textContent = group.name;
  el.componentPanelTitle.textContent = `${group.name} · Componentes`;
  el.componentPanelDescription.textContent = `${group.components.length} componente${group.components.length === 1 ? "" : "s"} monitorado${group.components.length === 1 ? "" : "s"} · ${group.description}`;
  renderComponentRows(group);
}

function consumerDisplayName(item) {
  if (item.kind === "docker") {
    const definition = DOCKER_GROUP_DEFINITIONS.find((group) => !group.allContainers && group.container?.test(item.sourceName));
    return definition ? `${definition.name} · ${friendlyComponentName(item.sourceName, definition)}` : friendlyComponentName(item.sourceName, { prefixes: [] });
  }
  const definition = SERVICE_GROUP_DEFINITIONS.find((group) => !group.allServices && group.service?.test(item.sourceName));
  return definition ? `${definition.name} · ${friendlyComponentName(item.sourceName, definition)}` : friendlyComponentName(item.sourceName, { prefixes: [] });
}

function usageLevel(value, maximum) {
  if (value <= 0) return 0;
  return Math.max(1, Math.min(10, Math.ceil(value / maximum * 10)));
}

function renderOverviewInsights(snapshot) {
  const groups = serviceGroups(snapshot).filter((group) => group.id !== "systemd");
  const healthyGroups = groups.filter((group) => group.health === "healthy").length;
  el.overviewAppSummary.textContent = `${healthyGroups} de ${groups.length} grupos operacionais`;
  el.overviewAppList.innerHTML = groups.map((group) => `<button class="overview-app-item" type="button" data-overview-service="${escapeHtml(group.id)}" aria-label="Abrir ${escapeHtml(group.name)}">
    <i class="status-dot ${escapeHtml(group.health)}"></i>
    <span class="overview-app-copy"><strong>${escapeHtml(group.name)}</strong><small>${group.running} de ${group.components.length} componentes ativos</small></span>
    <span class="overview-app-health ${escapeHtml(group.health)}">${groupHealthLabel(group.health)}</span>
  </button>`).join("");

  const consumers = [
    ...(snapshot.serviceUsage || []).map((item) => ({
      kind: "systemd", sourceName: item.unit, sourceDetail: `${item.processCount} processo${item.processCount === 1 ? "" : "s"}`,
      cpuPercent: number(item.cpuPercent), memoryPercent: number(item.memoryPercent),
    })),
    ...(snapshot.containers || []).map((item) => ({
      kind: "docker", sourceName: item.name, sourceDetail: item.memoryUsage || item.image,
      cpuPercent: number(item.cpuPercent), memoryPercent: number(item.memoryPercent),
    })),
  ].filter((item) => item.cpuPercent > 0 || item.memoryPercent > 0)
    .sort((a, b) => (b.cpuPercent + b.memoryPercent) - (a.cpuPercent + a.memoryPercent))
    .slice(0, 7);

  el.overviewConsumerSummary.textContent = `${(snapshot.serviceUsage || []).length} serviços e ${(snapshot.containers || []).length} contêineres analisados`;
  if (!consumers.length) {
    el.overviewConsumerList.innerHTML = `<div class="empty-panel"><strong>Sem dados de consumo</strong><span>A próxima atualização tentará coletar CPU e memória por serviço.</span></div>`;
  } else {
    const maxCpu = Math.max(...consumers.map((item) => item.cpuPercent), 1);
    const maxMemory = Math.max(...consumers.map((item) => item.memoryPercent), 1);
    el.overviewConsumerList.innerHTML = `<div class="consumer-list-head"><span>Serviço</span><span>CPU</span><span>Memória</span></div>${consumers.map((item) => {
      const cpuLevel = usageLevel(item.cpuPercent, maxCpu);
      const memoryLevel = usageLevel(item.memoryPercent, maxMemory);
      return `<div class="consumer-row">
        <div class="consumer-identity"><i class="status-dot healthy"></i><div class="consumer-copy"><strong>${escapeHtml(consumerDisplayName(item))}</strong><small>${escapeHtml(item.sourceName)} · ${escapeHtml(item.sourceDetail)}</small></div><span class="consumer-kind">${item.kind}</span></div>
        <span class="consumer-usage"><b>${percent(item.cpuPercent)}</b><span class="usage-track"><i class="usage-level-${cpuLevel}"></i></span></span>
        <span class="consumer-usage memory"><b>${percent(item.memoryPercent)}</b><span class="usage-track"><i class="usage-level-${memoryLevel}"></i></span></span>
      </div>`;
    }).join("")}`;
  }

  const failedServices = snapshot.services.filter((service) => service.health === "critical").length;
  const failedContainers = snapshot.containers.filter((container) => container.health === "critical").length;
  el.overviewFailedServices.textContent = String(failedServices);
  el.overviewFailedContainers.textContent = String(failedContainers);
  el.overviewJournalErrors.textContent = String(snapshot.errors.length);
  if (!snapshot.alerts.length) {
    el.overviewAttentionList.innerHTML = `<div class="attention-clear"><i></i><strong>Nenhuma ação necessária</strong><span>Serviços, Docker e recursos do servidor estão dentro dos limites.</span></div>`;
  } else {
    el.overviewAttentionList.innerHTML = snapshot.alerts.map((alert) => `<div class="attention-item">
      <i class="status-dot ${escapeHtml(alert.severity)}"></i>
      <span class="attention-copy"><strong>${escapeHtml(alert.title)}</strong><small>${escapeHtml(alert.detail)}</small></span>
    </div>`).join("");
  }
}

function renderContainerRows(containers) {
  if (state.onlyIssues) containers = containers.filter((container) => container.health === "critical");
  if (!containers.length) {
    el.containerList.innerHTML = `<tr><td colspan="6"><div class="empty-panel"><strong>${state.onlyIssues ? "Nenhum contêiner com problema" : "Nenhum contêiner encontrado"}</strong><span>${state.onlyIssues ? "Todos os contêineres estão operacionais." : "O Docker pode não estar acessível."}</span></div></td></tr>`;
    return;
  }
  containers = [...containers].sort((a, b) => (a.health === "critical" ? -1 : 1) - (b.health === "critical" ? -1 : 1));
  el.containerList.innerHTML = containers.map((container) => `<tr>
    <td><span class="container-name"><i class="status-dot ${escapeHtml(container.health)}"></i>${escapeHtml(container.name)}</span></td>
    <td><span class="container-state"><i class="${escapeHtml(container.health)}"></i><span title="${escapeHtml(container.status)}">${escapeHtml(container.status)}</span></span></td>
    <td title="${escapeHtml(container.image)}">${escapeHtml(container.image)}</td>
    <td class="usage-value">${number(container.cpuPercent).toFixed(1)}%</td>
    <td class="usage-value" title="${escapeHtml(container.memoryUsage)}">${number(container.memoryPercent).toFixed(1)}%</td>
    <td title="${escapeHtml(container.ports || "Sem portas publicadas")}">${escapeHtml(container.ports || "—")}</td>
  </tr>`).join("");
}

function renderContainers() {
  if (!state.snapshot) return;
  const groups = dockerGroups(state.snapshot);
  const group = groups.find((item) => item.id === state.currentGroup);
  el.navContainersCount.textContent = String(groups.length);
  el.navContainersCount.classList.toggle("has-alert", groups.some((item) => item.health === "critical"));
  el.containerCatalogView.hidden = Boolean(group);
  el.containerDetailView.hidden = !group;

  if (!group) {
    el.containerScreenEyebrow.textContent = "DOCKER";
    el.containerScreenTitle.textContent = "Contêineres";
    el.containerScreenDescription.textContent = "Aplicações Docker organizadas por projeto.";
    el.containersScreenTotal.textContent = String(groups.length);
    el.containersScreenTotalLabel.textContent = "projetos monitorados";
    el.containerGroupList.innerHTML = groupCardsMarkup(groups, "data-container-group");
    return;
  }

  el.containerScreenEyebrow.textContent = `DOCKER / ${group.eyebrow.toUpperCase()}`;
  el.containerScreenTitle.textContent = group.name;
  el.containerScreenDescription.textContent = group.description;
  el.containersScreenTotal.textContent = String(group.containers.length);
  el.containersScreenTotalLabel.textContent = group.containers.length === 1 ? "contêiner monitorado" : "contêineres monitorados";
  el.containerGroupTitle.textContent = group.name;
  el.containerPanelTitle.textContent = `${group.name} · Contêineres`;
  el.containersRunning.textContent = String(group.running);
  el.containerPanelDescription.textContent = group.running === 1 ? "ativo neste projeto" : "ativos neste projeto";
  renderContainerRows(group.containers);
}

function renderDistribution(snapshot) {
  const journal = snapshot.errors.length;
  const services = snapshot.services.filter((service) => service.health === "critical").length;
  const containers = snapshot.containers.filter((container) => container.health === "critical").length;
  const total = journal + services + containers;
  el.incidentCount.textContent = String(total);
  el.navIncidentsCount.textContent = String(total);
  el.navIncidentsCount.classList.toggle("has-alert", total > 0);
  el.journalErrorCount.textContent = String(journal);
  el.failedServiceCount.textContent = String(services);
  el.failedContainerCount.textContent = String(containers);
  if (!total) el.errorDonut.style.background = "conic-gradient(#d3d3d3 0 100%)";
  else {
    const journalEnd = journal / total * 100, serviceEnd = (journal + services) / total * 100;
    el.errorDonut.style.background = `conic-gradient(var(--red) 0 ${journalEnd}%, var(--yellow) ${journalEnd}% ${serviceEnd}%, var(--pink) ${serviceEnd}% 100%)`;
  }
}

function incidentIcon() { return `<svg viewBox="0 0 24 24"><path d="M12 3 2 20h20L12 3Zm0 6v5m0 3v.01"/></svg>`; }

function renderIncidents(snapshot) {
  const items = [
    ...snapshot.alerts.filter((alert) => alert.code !== "journal-errors").map((alert) => ({ ...alert, timestamp: snapshot.collectedAt })),
    ...snapshot.errors.slice(0, 24).map((error) => ({ severity: error.severity || "critical", title: "Erro registrado no sistema", detail: error.message, timestamp: error.timestamp })),
  ];
  if (!items.length) {
    el.incidentList.innerHTML = `<div class="empty-incidents"><strong>Nenhum incidente detectado</strong><span>Não há falhas de serviço nem erros críticos no journal na última hora.</span></div>`;
    return;
  }
  el.incidentList.innerHTML = items.map((item) => `<div class="incident-item">
    <span class="incident-icon ${escapeHtml(item.severity)}">${incidentIcon()}</span>
    <div class="incident-copy"><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.detail)}</p><time>${escapeHtml(formatLogTime(item.timestamp))}</time></div>
  </div>`).join("");
}

function renderAlert(snapshot) {
  if (!snapshot.alerts.length) { el.alertBanner.classList.add("hidden"); return; }
  const alert = snapshot.alerts.find((item) => item.severity === "critical") || snapshot.alerts[0];
  el.alertBanner.classList.remove("hidden", "critical");
  if (alert.severity === "critical") el.alertBanner.classList.add("critical");
  el.alertTitle.textContent = alert.title;
  el.alertDetail.textContent = snapshot.alerts.length > 1 ? `${alert.detail} Mais ${snapshot.alerts.length - 1} alerta(s).` : alert.detail;
}

function render(snapshot) {
  state.snapshot = snapshot;
  const hostname = snapshot.hostname || snapshot.target || "notserver";
  const disk = snapshot.disks.find((item) => item.mount === "/") || snapshot.disks[0] || { usedPercent: 0, used: 0, mount: "—" };
  const failedServices = snapshot.services.filter((service) => service.health === "critical").length;
  const activeServices = snapshot.services.filter((service) => service.active === "active").length;
  const availability = snapshot.reachable && snapshot.services.length ? ((snapshot.services.length - failedServices) / snapshot.services.length) * 100 : snapshot.reachable ? 100 : 0;

  el.heroHost.textContent = hostname;
  el.serverDescription.textContent = snapshot.reachable ? `${snapshot.os || "Linux"} · ${snapshot.kernel || ""} · ${snapshot.target}` : snapshot.error || "Servidor inacessível";
  el.lastUpdate.textContent = formatTime(snapshot.collectedAt);
  el.uptime.textContent = snapshot.reachable ? formatUptime(snapshot.uptimeSeconds) : "—";
  setStatusClass(el.statusOrb, snapshot.overall || "critical");
  setStatusClass(el.overallChip, snapshot.overall || "critical");
  el.overallChip.querySelector("span").textContent = overallLabel(snapshot);

  updateMetric(snapshot.metrics.cpuPercent, el.cpuValue, el.cpuState);
  updateMetric(snapshot.metrics.memoryPercent, el.memoryValue, el.memoryState);
  updateMetric(disk.usedPercent, el.diskValue, el.diskState);
  updateAvailability(availability);
  el.loadValue.textContent = `${snapshot.metrics.load1.toFixed(2)} / ${snapshot.metrics.load5.toFixed(2)}`;
  el.memoryUsed.textContent = formatBytes(snapshot.metrics.memoryUsed);
  el.memoryTotal.textContent = formatBytes(snapshot.metrics.memoryTotal);
  el.diskUsed.textContent = formatBytes(disk.used);
  el.diskMount.textContent = disk.mount;
  el.servicesRunning.textContent = String(activeServices);
  el.servicesFailed.textContent = String(failedServices);
  el.legendCpu.textContent = percent(snapshot.metrics.cpuPercent);
  el.legendMemory.textContent = percent(snapshot.metrics.memoryPercent);
  el.legendDisk.textContent = percent(disk.usedPercent);

  recordHistory(snapshot, disk, availability);
  renderHistory();
  renderServices();
  renderContainers();
  renderOverviewInsights(snapshot);
  renderDistribution(snapshot);
  renderIncidents(snapshot);
  renderAlert(snapshot);
  el.footerSystem.textContent = snapshot.reachable ? `${snapshot.systemState} · ${snapshot.services.length} serviços · ${snapshot.containers.length} contêineres` : "Servidor inacessível";
  updateDocumentTitle();
}

function showToast(message) {
  el.toast.textContent = message;
  el.toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => el.toast.classList.remove("show"), 3000);
}

async function loadStatus(force = false) {
  if (state.loading) return;
  state.loading = true;
  el.refreshButton.classList.add("spinning");
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(`/api/status${force ? "?refresh=1" : ""}`, { cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error(`A API respondeu com status ${response.status}.`);
    render(await response.json());
    state.countdown = 15;
  } catch (error) {
    showToast(error.name === "AbortError" ? "A atualização excedeu o tempo limite." : error.message);
    if (!state.snapshot) render({ target: "notserver", hostname: "notserver", reachable: false, overall: "critical", collectedAt: new Date().toISOString(), uptimeSeconds: 0, metrics: { cpuPercent: 0, memoryPercent: 0, memoryUsed: 0, memoryTotal: 0, load1: 0, load5: 0 }, disks: [], services: [], containers: [], errors: [], alerts: [{ severity: "critical", code: "ui-offline", title: "Monitor desconectado", detail: error.message }], error: error.message });
  } finally {
    clearTimeout(timeout);
    state.loading = false;
    el.refreshButton.classList.remove("spinning");
  }
}

async function openLogs(unit) {
  el.logTitle.textContent = unit;
  el.logContent.innerHTML = '<span class="spinner"></span>';
  el.logDialog.showModal();
  try {
    const response = await fetch(`/api/logs?unit=${encodeURIComponent(unit)}`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Não foi possível carregar os logs.");
    el.logContent.textContent = payload.lines.length ? payload.lines.join("\n") : "Nenhum registro de prioridade warning ou superior nas últimas 24 horas.";
  } catch (error) { el.logContent.textContent = `Erro ao consultar logs: ${error.message}`; }
}

el.refreshButton.addEventListener("click", () => loadStatus(true));
el.printButton.addEventListener("click", () => window.print());
el.copyButton.addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(location.href); showToast("Link copiado."); }
  catch { showToast("Não foi possível copiar o link."); }
});
el.issueFilter.addEventListener("click", () => {
  state.onlyIssues = !state.onlyIssues;
  el.issueFilter.classList.toggle("active", state.onlyIssues);
  el.issueFilter.setAttribute("aria-pressed", String(state.onlyIssues));
  el.issueFilter.querySelector("span").textContent = state.onlyIssues ? "Somente problemas" : "Adicionar filtro";
  renderServices(); renderContainers();
});
document.querySelectorAll("[data-screen]").forEach((button) => button.addEventListener("click", () => showScreen(button.dataset.screen)));
document.querySelectorAll("[data-screen-link]").forEach((link) => link.addEventListener("click", (event) => {
  event.preventDefault();
  showScreen(link.dataset.screenLink);
}));
window.addEventListener("popstate", () => showScreen(routeFromHash(), false));
window.addEventListener("hashchange", () => showScreen(routeFromHash(), false));
el.liveToggle.addEventListener("click", () => {
  state.live = !state.live;
  el.liveToggle.classList.toggle("active", state.live);
  el.liveToggle.setAttribute("aria-pressed", String(state.live));
  el.refreshCountdown.textContent = state.live ? `${state.countdown}s` : "pausado";
});
el.serviceFilter.addEventListener("change", renderServices);
el.serviceSearch.addEventListener("input", renderServices);
el.serviceGroupList.addEventListener("click", (event) => {
  const card = event.target.closest("[data-service-group]");
  if (card) showScreen(`services/${card.dataset.serviceGroup}`);
});
el.serviceBack.addEventListener("click", () => showScreen("services"));
el.containerGroupList.addEventListener("click", (event) => {
  const card = event.target.closest("[data-container-group]");
  if (card) showScreen(`containers/${card.dataset.containerGroup}`);
});
el.containerBack.addEventListener("click", () => showScreen("containers"));
el.overviewAppList.addEventListener("click", (event) => {
  const item = event.target.closest("[data-overview-service]");
  if (item) showScreen(`services/${item.dataset.overviewService}`);
});
el.serviceList.addEventListener("click", (event) => { const button = event.target.closest("[data-unit]"); if (button) openLogs(button.dataset.unit); });
el.closeDialog.addEventListener("click", () => el.logDialog.close());
el.logDialog.addEventListener("click", (event) => {
  const bounds = el.logDialog.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) el.logDialog.close();
});

setInterval(() => {
  if (!state.live) return;
  state.countdown -= 1;
  if (state.countdown <= 0) { state.countdown = 15; loadStatus(); }
  el.refreshCountdown.textContent = `${state.countdown}s`;
}, 1000);

el.liveToggle.classList.add("active");
showScreen(routeFromHash(), false);
loadStatus(true);
