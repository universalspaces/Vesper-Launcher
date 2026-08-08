const byId = (id) => document.getElementById(id);

let toastTimer = null;
let resetTimer = null;
let currentStatus = null;
let currentSettings = null;
let statusReceivedAt = Date.now();

function showToast(message, error = false) {
  const toast = byId("toast");
  toast.textContent = message;
  toast.classList.toggle("error", error);
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2800);
}

function setDot(element, state) {
  if (!element) return;
  element.classList.remove("online", "error", "busy");
  if (state) element.classList.add(state);
}

function rpcLabel(status) {
  return { connected: "Connected", connecting: "Connecting…", disabled: "Disabled", disconnected: "Discord unavailable", error: "Connection error" }[status] || "Offline";
}

function rpcDotState(status) {
  if (status === "connected") return "online";
  if (status === "connecting") return "busy";
  if (status === "error" || status === "disconnected") return "error";
  return "";
}

function packLabel(pack) {
  if (!pack) return "Checking…";
  return {
    installed: `Installed · v${pack.installedVersion}`,
    outdated: `Outdated · v${pack.installedVersion}`,
    newer: `Newer · v${pack.installedVersion}`,
    duplicates: `${pack.copies} copies detected`,
    missing: "Not installed",
    unavailable: "Unavailable",
  }[pack.status] || "Unknown";
}

function packDotState(pack) {
  if (["installed", "newer"].includes(pack?.status)) return "online";
  if (["outdated", "duplicates"].includes(pack?.status)) return "busy";
  if (["missing", "unavailable"].includes(pack?.status)) return "error";
  return "";
}

function packBadge(pack) {
  return { installed: "READY", newer: "NEWER", outdated: "UPDATE", duplicates: "CHECK", missing: "MISSING", unavailable: "N/A" }[pack?.status] || "...";
}

function updateUpdateState(state = {}) {
  const panel = byId("update-panel");
  if (!panel) return;
  const development = state.status === "development";
  panel.classList.toggle("hidden", development);
  if (development) return;
  const label = {
    idle: "Ready",
    checking: "Checking…",
    current: "Up to date",
    downloading: state.version ? `Downloading v${state.version} · ${state.percent || 0}%` : `Downloading · ${state.percent || 0}%`,
    ready: state.version ? `v${state.version} ready` : "Update ready",
    error: "Update check failed",
  }[state.status] || "Ready";
  byId("update-status").textContent = label;
  byId("check-updates").disabled = ["checking", "downloading"].includes(state.status);
  byId("install-update").classList.toggle("hidden", state.status !== "ready");
}

function formatClock(ms) {
  const seconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return hours > 0
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function formatDuration(ms) {
  const minutes = Math.max(0, Math.floor(Number(ms || 0) / 60000));
  if (Number(ms || 0) <= 0) return "0m";
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  if (hours > 0) return `${hours}h ${remaining}m`;
  return minutes > 0 ? `${minutes}m` : "<1m";
}

function formatWhen(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function liveStats() {
  if (!currentStatus?.stats) return null;
  const extra = currentStatus.gameRunning ? Math.max(0, Date.now() - statusReceivedAt) : 0;
  return { ...currentStatus.stats, totalPlaytimeMs: currentStatus.stats.totalPlaytimeMs + extra, currentSessionMs: currentStatus.stats.currentSessionMs + extra };
}

function renderRecentSessions(sessions = []) {
  const list = byId("recent-sessions");
  list.replaceChildren();
  if (!sessions.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No tracked sessions";
    list.appendChild(empty);
    return;
  }
  sessions.slice(0, 6).forEach((session) => {
    const row = document.createElement("div");
    row.className = "session-row";
    const when = document.createElement("span");
    when.textContent = formatWhen(session.endedAt || session.startedAt);
    const title = document.createElement("strong");
    title.textContent = "Minecraft Bedrock";
    const duration = document.createElement("span");
    duration.textContent = formatDuration(session.durationMs);
    row.append(when, title, duration);
    list.appendChild(row);
  });
}

function updateActivity() {
  const stats = liveStats();
  if (!stats) return;
  byId("stat-total").textContent = formatDuration(stats.totalPlaytimeMs);
  byId("stat-sessions").textContent = String(stats.sessionCount || 0);
  byId("stat-longest").textContent = formatDuration(Math.max(stats.longestSessionMs || 0, stats.currentSessionMs || 0));
  byId("stat-launches").textContent = String(stats.launchCount || 0);
  byId("last-played-label").textContent = stats.lastPlayedAt ? `Last played ${formatWhen(stats.lastPlayedAt)}` : "No sessions yet";
  const activityState = byId("activity-state");
  activityState.textContent = currentStatus.gameRunning ? "LIVE" : "IDLE";
  activityState.classList.toggle("ready", currentStatus.gameRunning);
}

function updateSessionClock() {
  if (!currentStatus?.gameRunning) {
    byId("session-card-title").textContent = "Idle";
    byId("session-card-copy").textContent = currentStatus?.stats?.lastSessionMs ? `Last · ${formatDuration(currentStatus.stats.lastSessionMs)}` : "No active game";
    byId("session-card-badge").textContent = "IDLE";
    byId("session-card-badge").classList.remove("connected");
  } else {
    const stats = liveStats();
    byId("session-card-title").textContent = formatClock(stats?.currentSessionMs || 0);
    byId("session-card-copy").textContent = "Minecraft Bedrock";
    byId("session-card-badge").textContent = "LIVE";
    byId("session-card-badge").classList.add("connected");
  }
  updateActivity();
}

function updateDiagnostics(status) {
  const minecraft = status.minecraft || {};
  const pack = status.pack || {};
  byId("diag-minecraft").textContent = minecraft.installed ? (status.gameRunning ? "Running" : "Installed") : "Not found";
  byId("diag-version").textContent = minecraft.version || "—";
  byId("diag-pack").textContent = packLabel(pack);
  byId("diag-pack-copies").textContent = String(pack.copies ?? "—");
  byId("diag-appid").textContent = minecraft.appId || "—";
  byId("diag-package").textContent = minecraft.packageFullName || minecraft.packageName || "—";
  byId("diag-rpc").textContent = rpcLabel(status.rpc?.status);
  byId("diag-sessions").textContent = String(status.stats?.sessionCount || 0);
  byId("diag-platform").textContent = status.platform === "win32" ? "Windows" : status.platform;
  const healthyPack = ["installed", "newer"].includes(pack.status);
  const healthyRpc = ["connected", "disabled"].includes(status.rpc?.status);
  const ready = minecraft.installed && healthyPack && healthyRpc;
  byId("diagnostics-health").textContent = ready ? "READY" : "CHECK";
  byId("diagnostics-health").classList.toggle("ready", ready);
}

function updateSetup(status) {
  const minecraft = status.minecraft || {};
  const pack = status.pack || {};
  const rpc = status.rpc || {};
  setDot(byId("setup-minecraft-dot"), minecraft.installed ? "online" : "error");
  byId("setup-minecraft-state").textContent = minecraft.installed ? "Ready" : "Not found";
  setDot(byId("setup-pack-dot"), packDotState(pack));
  byId("setup-pack-state").textContent = packLabel(pack);
  setDot(byId("setup-rpc-dot"), rpcDotState(rpc.status));
  byId("setup-rpc-state").textContent = rpcLabel(rpc.status);
  byId("setup-import-pack").classList.toggle("hidden", ["installed", "newer"].includes(pack.status));
}

function applyStatus(status) {
  currentStatus = status;
  statusReceivedAt = Date.now();
  byId("top-version").textContent = `v${status.launcherVersion}`;
  byId("diag-launcher-version").textContent = `v${status.launcherVersion}`;
  const minecraft = status.minecraft || {};
  const pack = status.pack || {};
  const minecraftLabel = status.gameRunning ? "Running" : minecraft.installed ? (minecraft.version ? `Installed · ${minecraft.version}` : "Installed") : status.platform === "win32" ? "Not found" : "Windows only";
  byId("minecraft-state").textContent = minecraftLabel;
  byId("side-minecraft").textContent = minecraftLabel;
  const minecraftDot = status.gameRunning || minecraft.installed ? "online" : "error";
  setDot(byId("minecraft-dot"), minecraftDot);
  setDot(byId("side-minecraft-dot"), minecraftDot);

  const packText = packLabel(pack);
  const packDot = packDotState(pack);
  byId("pack-state").textContent = packText;
  byId("side-pack").textContent = packText;
  byId("pack-card-title").textContent = pack.status === "installed" ? `v${pack.installedVersion}` : packText;
  byId("pack-card-copy").textContent = `v${status.packVersion} bundled`;
  byId("pack-card-badge").textContent = packBadge(pack);
  byId("pack-card-badge").classList.toggle("connected", ["installed", "newer"].includes(pack.status));
  setDot(byId("pack-dot"), packDot);
  setDot(byId("side-pack-dot"), packDot);
  byId("pack-installed-version").textContent = pack.installedVersion ? `v${pack.installedVersion}` : "—";
  byId("pack-copy-count").textContent = String(pack.copies ?? "—");
  byId("pack-health-chip").textContent = packBadge(pack);
  byId("pack-health-chip").classList.toggle("ready", ["installed", "newer"].includes(pack.status));

  const rpc = status.rpc || { status: "disconnected" };
  const rpcText = rpcLabel(rpc.status);
  const dotState = rpcDotState(rpc.status);
  byId("side-rpc").textContent = rpcText;
  byId("settings-rpc-status").textContent = rpcText;
  byId("rpc-card-copy").textContent = rpcText;
  byId("rpc-card-badge").textContent = rpc.status === "connected" ? "LIVE" : rpcText.toUpperCase();
  byId("rpc-card-badge").classList.toggle("connected", rpc.status === "connected");
  setDot(byId("side-rpc-dot"), dotState);
  setDot(byId("settings-rpc-dot"), dotState);
  byId("rail-rpc-dot").className = `rail-status ${rpc.status === "connected" ? "connected" : (["error", "disconnected"].includes(rpc.status) ? "error" : "")}`;

  byId("preview-details").textContent = status.gameRunning ? `Minecraft Bedrock${minecraft.version ? ` ${minecraft.version}` : ""}` : "Vesper Launcher";
  byId("preview-state").textContent = `Vesper UI v${status.packVersion}`;
  const launchLabel = byId("launch-button").querySelector("span:last-child");
  launchLabel.textContent = status.gameRunning ? "RUNNING" : minecraft.installed ? "LAUNCH" : "NOT INSTALLED";
  byId("launch-button").disabled = status.gameRunning || !minecraft.installed;

  renderRecentSessions(status.stats?.recentSessions || []);
  updateSessionClock();
  updateDiagnostics(status);
  updateSetup(status);
  updateUpdateState(status.update);
}

function showView(name) {
  document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === `view-${name}`));
  document.querySelectorAll(".nav-button").forEach((button) => button.classList.toggle("active", button.dataset.view === name));
}

async function refreshStatus() {
  try { applyStatus(await window.vesper.status.get()); }
  catch (error) { showToast(error.message || "Status refresh failed.", true); }
}

async function importPack() {
  try {
    await window.vesper.minecraft.importPack();
    showToast("Vesper UI opened for import.");
    setTimeout(refreshStatus, 1800);
  } catch (error) { showToast(error.message || "Pack import failed.", true); }
}

async function loadSettings() {
  currentSettings = await window.vesper.settings.get();
  byId("rpc-enabled").checked = currentSettings.rpcEnabled;
  byId("minimize-on-launch").checked = currentSettings.minimizeOnLaunch;
  byId("restore-after-exit").checked = currentSettings.restoreAfterExit;
  byId("close-to-tray").checked = currentSettings.closeToTray;
  byId("launch-on-startup").checked = currentSettings.launchOnStartup;
  byId("setup-overlay").classList.toggle("hidden", currentSettings.firstRunComplete);
}

async function saveSettings() {
  try {
    currentSettings = await window.vesper.settings.save({
      rpcEnabled: byId("rpc-enabled").checked,
      minimizeOnLaunch: byId("minimize-on-launch").checked,
      restoreAfterExit: byId("restore-after-exit").checked,
      closeToTray: byId("close-to-tray").checked,
      launchOnStartup: byId("launch-on-startup").checked,
      firstRunComplete: Boolean(currentSettings?.firstRunComplete),
    });
    showToast("Settings saved.");
    setTimeout(refreshStatus, 250);
  } catch (error) { showToast(error.message || "Could not save settings.", true); }
}

async function invokeFolder(action, errorText) {
  try { await action(); }
  catch (error) { showToast(error.message || errorText, true); }
}

document.querySelectorAll(".nav-button").forEach((button) => button.addEventListener("click", () => showView(button.dataset.view)));
byId("window-minimize").addEventListener("click", () => window.vesper.window.minimize());
byId("window-maximize").addEventListener("click", () => window.vesper.window.maximize());
byId("window-close").addEventListener("click", () => window.vesper.window.close());
byId("import-pack-home").addEventListener("click", importPack);
byId("import-pack-page").addEventListener("click", importPack);
byId("setup-import-pack").addEventListener("click", importPack);
byId("show-pack-page").addEventListener("click", () => window.vesper.minecraft.showPack());
byId("open-installed-pack").addEventListener("click", () => invokeFolder(window.vesper.minecraft.openInstalledPack, "Pack folder was not found."));
byId("open-minecraft-data").addEventListener("click", () => invokeFolder(window.vesper.minecraft.openData, "Minecraft data folder was not found."));
byId("open-vesper-data").addEventListener("click", () => invokeFolder(window.vesper.app.openData, "Vesper data folder was not found."));
byId("save-settings").addEventListener("click", saveSettings);
byId("check-updates").addEventListener("click", async () => {
  byId("check-updates").disabled = true;
  try {
    const state = await window.vesper.updates.check();
    updateUpdateState(state);
    if (state.status === "current") showToast("Vesper is up to date.");
    if (state.status === "error") showToast("Update check failed.", true);
  } catch (error) { showToast(error.message || "Update check failed.", true); }
});
byId("install-update").addEventListener("click", async () => {
  try {
    const installing = await window.vesper.updates.install();
    if (!installing) showToast("Update is not ready yet.", true);
  } catch (error) { showToast(error.message || "Update could not be installed.", true); }
});
byId("reconnect-rpc").addEventListener("click", async () => {
  byId("reconnect-rpc").disabled = true;
  try { await window.vesper.rpc.reconnect(); await refreshStatus(); showToast("RPC reconnected."); }
  catch (error) { showToast(error.message || "RPC reconnect failed.", true); }
  finally { byId("reconnect-rpc").disabled = false; }
});
byId("refresh-diagnostics").addEventListener("click", refreshStatus);
byId("copy-diagnostics").addEventListener("click", async () => {
  try { await window.vesper.diagnostics.copy(); showToast("Diagnostics copied."); }
  catch (error) { showToast(error.message || "Could not copy diagnostics.", true); }
});
byId("minecraft-download").addEventListener("click", () => window.vesper.links.minecraftDownload());
byId("setup-continue").addEventListener("click", async () => {
  currentSettings = await window.vesper.setup.complete();
  byId("setup-overlay").classList.add("hidden");
});
byId("reset-stats").addEventListener("click", async () => {
  const button = byId("reset-stats");
  if (!button.classList.contains("confirming")) {
    button.classList.add("confirming");
    button.textContent = "CONFIRM RESET";
    clearTimeout(resetTimer);
    resetTimer = setTimeout(() => { button.classList.remove("confirming"); button.textContent = "RESET STATISTICS"; }, 4000);
    return;
  }
  clearTimeout(resetTimer);
  try {
    await window.vesper.stats.reset();
    button.classList.remove("confirming");
    button.textContent = "RESET STATISTICS";
    await refreshStatus();
    showToast("Statistics reset.");
  } catch (error) { showToast(error.message || "Statistics could not be reset.", true); }
});
byId("launch-button").addEventListener("click", async () => {
  const button = byId("launch-button");
  button.disabled = true;
  try { await window.vesper.minecraft.launch(); showToast("Minecraft launched."); }
  catch (error) { showToast(error.message || "Could not launch Minecraft.", true); button.disabled = false; }
});

document.addEventListener("keydown", (event) => {
  if (event.ctrlKey && !event.shiftKey && !event.altKey) {
    const views = { "1": "home", "2": "pack", "3": "activity", "4": "diagnostics", "5": "settings" };
    if (views[event.key]) { event.preventDefault(); showView(views[event.key]); }
    if (event.key.toLowerCase() === "l" && !byId("launch-button").disabled) { event.preventDefault(); byId("launch-button").click(); }
    if (event.key.toLowerCase() === "r") { event.preventDefault(); refreshStatus(); }
  } else if (event.key === "Escape" && byId("setup-overlay").classList.contains("hidden")) {
    showView("home");
  }
});

window.vesper.status.subscribe(applyStatus);
window.vesper.updates.subscribe(updateUpdateState);
setInterval(updateSessionClock, 1000);

(async () => {
  await loadSettings();
  await refreshStatus();

  // Dismiss splash after everything is ready
  const splash = byId("splash-screen");
  if (splash) {
    // Minimum display time (ms) so the animation isn't jarring
    const minDisplay = 1800;
    const elapsed = Date.now() - statusReceivedAt;
    const remaining = Math.max(0, minDisplay - elapsed);

    setTimeout(() => {
      splash.classList.add("done");
      // Remove from DOM after transition to free resources
      setTimeout(() => splash.remove(), 700);
    }, remaining);
  }
})();