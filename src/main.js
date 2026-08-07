const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage, clipboard } = require("electron");
const { execFile, spawn } = require("node:child_process");
const { promisify } = require("node:util");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Client: DiscordRPCClient } = require("@xhayper/discord-rpc");
const { autoUpdater } = require("electron-updater");

const execFileAsync = promisify(execFile);
const LAUNCHER_VERSION = app.getVersion();
const VESPER_PACK_VERSION = "1.4.1";
const VESPER_PACK_UUID = "e12f7b13-9454-4e73-abdc-90d81725f190";
const DISCORD_CLIENT_ID = "1535375919215017986";
const DISCORD_LARGE_IMAGE_KEY = "vesper";
const launcherStartedAt = new Date();
const DEFAULT_SETTINGS = Object.freeze({
  rpcEnabled: true,
  minimizeOnLaunch: true,
  restoreAfterExit: true,
  closeToTray: true,
  launchOnStartup: false,
  firstRunComplete: false,
});
const DEFAULT_STATS = Object.freeze({
  totalPlaytimeMs: 0,
  longestSessionMs: 0,
  launchCount: 0,
  sessionCount: 0,
  lastPlayedAt: null,
  lastSessionMs: 0,
  recentSessions: [],
});

let mainWindow = null;
let tray = null;
let rpcClient = null;
let rpcStatus = "connecting";
let rpcError = "";
let monitorTimer = null;
let updateTimer = null;
let gameRunning = false;
let gameStartedAt = null;
let isQuitting = false;
let settings = { ...DEFAULT_SETTINGS };
let stats = { ...DEFAULT_STATS, recentSessions: [] };
let lastMinecraftInfo = null;
let lastPackStatus = null;
let updateState = { status: app.isPackaged ? "idle" : "development", version: "", percent: 0, error: "" };

app.setName("Vesper Launcher");

function settingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

function statsPath() {
  return path.join(app.getPath("userData"), "stats.json");
}

function sanitizeSettings(value) {
  return {
    rpcEnabled: Boolean(value.rpcEnabled),
    minimizeOnLaunch: Boolean(value.minimizeOnLaunch),
    restoreAfterExit: Boolean(value.restoreAfterExit),
    closeToTray: Boolean(value.closeToTray),
    launchOnStartup: Boolean(value.launchOnStartup),
    firstRunComplete: Boolean(value.firstRunComplete),
  };
}

function loadSettings() {
  try {
    settings = sanitizeSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(settingsPath(), "utf8")) });
  } catch {
    settings = { ...DEFAULT_SETTINGS };
  }
  return settings;
}

function saveSettings(nextSettings) {
  settings = sanitizeSettings({ ...settings, ...nextSettings });
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), "utf8");
  return settings;
}

function sanitizeStats(value) {
  const number = (input) => Number.isFinite(Number(input)) && Number(input) >= 0 ? Number(input) : 0;
  const recentSessions = Array.isArray(value.recentSessions)
    ? value.recentSessions.slice(0, 12).map((session) => ({
        startedAt: typeof session.startedAt === "string" ? session.startedAt : null,
        endedAt: typeof session.endedAt === "string" ? session.endedAt : null,
        durationMs: number(session.durationMs),
      })).filter((session) => session.startedAt)
    : [];
  return {
    totalPlaytimeMs: number(value.totalPlaytimeMs),
    longestSessionMs: number(value.longestSessionMs),
    launchCount: number(value.launchCount),
    sessionCount: number(value.sessionCount),
    lastPlayedAt: typeof value.lastPlayedAt === "string" ? value.lastPlayedAt : null,
    lastSessionMs: number(value.lastSessionMs),
    recentSessions,
  };
}

function loadStats() {
  try {
    stats = sanitizeStats({ ...DEFAULT_STATS, ...JSON.parse(fs.readFileSync(statsPath(), "utf8")) });
  } catch {
    stats = { ...DEFAULT_STATS, recentSessions: [] };
  }
  return stats;
}

function saveStats() {
  fs.mkdirSync(path.dirname(statsPath()), { recursive: true });
  fs.writeFileSync(statsPath(), JSON.stringify(stats, null, 2), "utf8");
}

function statsSnapshot() {
  const activeMs = gameRunning && gameStartedAt ? Math.max(0, Date.now() - gameStartedAt.getTime()) : 0;
  return {
    ...stats,
    totalPlaytimeMs: stats.totalPlaytimeMs + activeMs,
    currentSessionMs: activeMs,
  };
}

function publicUpdateState() {
  return { ...updateState };
}

function sendUpdateState() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("updates:status", publicUpdateState());
}

function setUpdateState(nextState) {
  updateState = { ...updateState, ...nextState };
  sendUpdateState();
}

async function checkForLauncherUpdate() {
  if (!app.isPackaged || process.platform !== "win32") {
    setUpdateState({ status: "development", version: "", percent: 0, error: "" });
    return publicUpdateState();
  }
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    setUpdateState({ status: "error", error: error.message || "Update check failed." });
  }
  return publicUpdateState();
}

function configureUpdater() {
  if (!app.isPackaged || process.platform !== "win32") {
    setUpdateState({ status: "development" });
    return;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.on("checking-for-update", () => setUpdateState({ status: "checking", percent: 0, error: "" }));
  autoUpdater.on("update-available", (info) => setUpdateState({ status: "downloading", version: info.version || "", percent: 0, error: "" }));
  autoUpdater.on("update-not-available", () => setUpdateState({ status: "current", version: "", percent: 0, error: "" }));
  autoUpdater.on("download-progress", (progress) => setUpdateState({ status: "downloading", percent: Math.max(0, Math.min(100, Math.round(progress.percent || 0))) }));
  autoUpdater.on("update-downloaded", (info) => setUpdateState({ status: "ready", version: info.version || updateState.version, percent: 100, error: "" }));
  autoUpdater.on("error", (error) => setUpdateState({ status: "error", error: error?.message || "Update failed." }));
  setTimeout(() => checkForLauncherUpdate().catch(() => {}), 5000);
  updateTimer = setInterval(() => checkForLauncherUpdate().catch(() => {}), 6 * 60 * 60 * 1000);
}

function installLauncherUpdate() {
  if (!app.isPackaged || updateState.status !== "ready") return false;
  isQuitting = true;
  autoUpdater.quitAndInstall(false, true);
  return true;
}

function beginGameSession() {
  if (gameStartedAt) return;
  gameStartedAt = new Date();
  stats.sessionCount += 1;
  saveStats();
}

function finishGameSession() {
  if (!gameStartedAt) return;
  const endedAt = new Date();
  const durationMs = Math.max(0, endedAt.getTime() - gameStartedAt.getTime());
  stats.totalPlaytimeMs += durationMs;
  stats.lastSessionMs = durationMs;
  stats.longestSessionMs = Math.max(stats.longestSessionMs, durationMs);
  stats.lastPlayedAt = endedAt.toISOString();
  stats.recentSessions = [{ startedAt: gameStartedAt.toISOString(), endedAt: endedAt.toISOString(), durationMs }, ...stats.recentSessions].slice(0, 12);
  gameStartedAt = null;
  saveStats();
}

function applyStartupSetting() {
  if (process.platform !== "win32" || !app.isPackaged) return;
  app.setLoginItemSettings({
    openAtLogin: settings.launchOnStartup,
    path: process.execPath,
    args: ["--hidden"],
  });
}

async function runPowerShell(script) {
  if (process.platform !== "win32") {
    throw new Error("Vesper Launcher currently supports Minecraft Bedrock on Windows 10/11 only.");
  }
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
    { windowsHide: true, timeout: 12000, maxBuffer: 1024 * 1024 },
  );
  return stdout.trim();
}

async function getMinecraftInfo() {
  if (process.platform !== "win32") {
    return { installed: false, name: "Minecraft for Windows", appId: "", version: "", packageName: "", packageFamilyName: "", packageFullName: "", dataRoot: "", dataRoots: [] };
  }

  const script = `
$start = Get-StartApps | Where-Object {
  ($_.Name -match '^Minecraft( for Windows)?$' -or $_.AppID -match 'Minecraft') -and
  $_.Name -notmatch 'Launcher|Education|Preview'
} | Select-Object -First 1;
$family = if ($start -and $start.AppID -match '!') { $start.AppID.Split('!')[0] } else { '' };
$pkg = if ($family) {
  Get-AppxPackage | Where-Object { $_.PackageFamilyName -eq $family } | Select-Object -First 1
} else {
  Get-AppxPackage | Where-Object {
    $_.Name -match 'Minecraft' -and $_.Name -notmatch 'Launcher|Education|Preview'
  } | Sort-Object Version -Descending | Select-Object -First 1
};
[PSCustomObject]@{
  Installed = [bool]$start;
  Name = if ($start) { $start.Name } else { 'Minecraft for Windows' };
  AppID = if ($start) { $start.AppID } else { '' };
  Version = if ($pkg) { [string]$pkg.Version } else { '' };
  PackageName = if ($pkg) { $pkg.Name } else { '' };
  PackageFamilyName = if ($pkg) { $pkg.PackageFamilyName } else { '' };
  PackageFullName = if ($pkg) { $pkg.PackageFullName } else { '' };
} | ConvertTo-Json -Compress
`;

  try {
    const parsed = JSON.parse(await runPowerShell(script));
    const packageFamilyName = parsed.PackageFamilyName || "";
    const localAppData = process.env.LOCALAPPDATA || "";
    const roamingAppData = process.env.APPDATA || "";
    const modernDataRoot = roamingAppData ? path.join(roamingAppData, "Minecraft Bedrock", "users", "shared", "games", "com.mojang") : "";
    const legacyDataRoot = packageFamilyName && localAppData
      ? path.join(localAppData, "Packages", packageFamilyName, "LocalState", "games", "com.mojang")
      : "";
    const dataRoots = [...new Set([modernDataRoot, legacyDataRoot].filter(Boolean))];
    const dataRoot = dataRoots.find((candidate) => fs.existsSync(candidate)) || modernDataRoot || legacyDataRoot || "";
    return {
      installed: Boolean(parsed.Installed),
      name: parsed.Name || "Minecraft for Windows",
      appId: parsed.AppID || "",
      version: parsed.Version || "",
      packageName: parsed.PackageName || "",
      packageFamilyName,
      packageFullName: parsed.PackageFullName || "",
      dataRoot,
      dataRoots,
    };
  } catch (error) {
    return { installed: false, name: "Minecraft for Windows", appId: "", version: "", packageName: "", packageFamilyName: "", packageFullName: "", dataRoot: "", dataRoots: [], error: error.message };
  }
}

async function isMinecraftRunning() {
  if (process.platform !== "win32") return false;
  const script = `
$game = Get-Process -ErrorAction SilentlyContinue | Where-Object {
  $_.ProcessName -match '^Minecraft(\\.Windows)?$'
} | Select-Object -First 1;
if ($game) { 'true' } else { 'false' }
`;
  try {
    return (await runPowerShell(script)).toLowerCase() === "true";
  } catch {
    return false;
  }
}

function versionParts(value) {
  return String(value || "0").split(".").map((part) => Number.parseInt(part, 10) || 0);
}

function compareVersions(a, b) {
  const left = versionParts(a);
  const right = versionParts(b);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (left[index] || 0) - (right[index] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

function findVesperPackManifests(root) {
  if (!root || !fs.existsSync(root)) return [];
  const matches = [];
  const visit = (directory, depth) => {
    if (depth > 2) return;
    let entries = [];
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const folder = path.join(directory, entry.name);
      const manifestPath = path.join(folder, "manifest.json");
      if (fs.existsSync(manifestPath)) {
        try {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
          if (String(manifest?.header?.uuid || "").toLowerCase() === VESPER_PACK_UUID) {
            matches.push({
              path: folder,
              version: Array.isArray(manifest.header.version) ? manifest.header.version.join(".") : String(manifest.header.version || "0"),
            });
          }
        } catch {}
      }
      visit(folder, depth + 1);
    }
  };
  visit(root, 0);
  return matches;
}

function getPackStatus(minecraft) {
  const dataRoots = Array.isArray(minecraft?.dataRoots) && minecraft.dataRoots.length ? minecraft.dataRoots : [minecraft?.dataRoot].filter(Boolean);
  const roots = dataRoots.map((dataRoot) => path.join(dataRoot, "resource_packs"));
  const root = roots.find((candidate) => fs.existsSync(candidate)) || roots[0] || "";
  if (!minecraft?.installed) return { status: "unavailable", installedVersion: "", expectedVersion: VESPER_PACK_VERSION, copies: 0, root };
  const matches = roots.flatMap((candidate) => findVesperPackManifests(candidate));
  if (!matches.length) return { status: "missing", installedVersion: "", expectedVersion: VESPER_PACK_VERSION, copies: 0, root };
  matches.sort((a, b) => compareVersions(b.version, a.version));
  const installedVersion = matches[0].version;
  let status = "installed";
  const comparison = compareVersions(installedVersion, VESPER_PACK_VERSION);
  if (comparison < 0) status = "outdated";
  if (comparison > 0) status = "newer";
  if (matches.length > 1) status = "duplicates";
  return { status, installedVersion, expectedVersion: VESPER_PACK_VERSION, copies: matches.length, root, paths: matches.map((match) => match.path) };
}

function bundledPackPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, `Vesper-UI-V${VESPER_PACK_VERSION}.mcpack`)
    : path.join(__dirname, "..", "assets", `Vesper-UI-V${VESPER_PACK_VERSION}.mcpack`);
}

async function launchMinecraft() {
  if (process.platform !== "win32") throw new Error("Minecraft Bedrock launching is supported on Windows 10/11 only.");
  const info = await getMinecraftInfo();
  if (!info.installed || !info.appId) throw new Error("Minecraft for Windows was not found.");
  const child = spawn("explorer.exe", [`shell:AppsFolder\\${info.appId}`], { detached: true, stdio: "ignore", windowsHide: true });
  child.unref();
  stats.launchCount += 1;
  saveStats();
  if (settings.minimizeOnLaunch && mainWindow) mainWindow.minimize();
  return { ok: true, name: info.name, version: info.version };
}

async function importVesperPack() {
  const packPath = bundledPackPath();
  if (!fs.existsSync(packPath)) throw new Error("The bundled Vesper UI pack is missing.");
  const error = await shell.openPath(packPath);
  if (error) throw new Error(error);
  return { ok: true, version: VESPER_PACK_VERSION };
}

function rpcActivity() {
  const bedrockVersion = lastMinecraftInfo?.version ? ` ${lastMinecraftInfo.version}` : "";
  const activity = gameRunning
    ? { details: `Minecraft Bedrock${bedrockVersion}`, state: `Vesper UI v${VESPER_PACK_VERSION}`, startTimestamp: gameStartedAt || new Date() }
    : { details: "Vesper Launcher", state: `Vesper UI v${VESPER_PACK_VERSION}`, startTimestamp: launcherStartedAt };
  activity.largeImageKey = DISCORD_LARGE_IMAGE_KEY;
  activity.largeImageText = `Vesper UI v${VESPER_PACK_VERSION}`;
  activity.instance = false;
  return activity;
}

async function disconnectRpc() {
  if (!rpcClient) return;
  const oldClient = rpcClient;
  rpcClient = null;
  try { await oldClient.user?.clearActivity(); } catch {}
  try { await oldClient.destroy(); } catch {}
}

async function connectRpc() {
  await disconnectRpc();
  rpcError = "";
  if (!settings.rpcEnabled) {
    rpcStatus = "disabled";
    await broadcastStatus();
    return;
  }
  rpcStatus = "connecting";
  await broadcastStatus();
  const client = new DiscordRPCClient({ clientId: DISCORD_CLIENT_ID });
  rpcClient = client;
  client.on("ready", async () => {
    if (client !== rpcClient) return;
    rpcStatus = "connected";
    rpcError = "";
    try { await client.user?.setActivity(rpcActivity()); } catch (error) { rpcError = error.message; }
    await broadcastStatus();
  });
  client.on("disconnected", async () => {
    if (client !== rpcClient) return;
    rpcStatus = "disconnected";
    await broadcastStatus();
  });
  try {
    await client.login();
  } catch (error) {
    if (client === rpcClient) {
      rpcStatus = "error";
      rpcError = error.message || "Could not connect to Discord.";
      rpcClient = null;
    }
    try { await client.destroy(); } catch {}
    await broadcastStatus();
  }
}

async function updateRpcActivity() {
  if (!rpcClient || rpcStatus !== "connected") return;
  try {
    await rpcClient.user?.setActivity(rpcActivity());
    rpcError = "";
  } catch (error) {
    rpcError = error.message;
  }
}

async function getStatus() {
  const minecraft = await getMinecraftInfo();
  const pack = getPackStatus(minecraft);
  lastMinecraftInfo = minecraft;
  lastPackStatus = pack;
  return {
    platform: process.platform,
    launcherVersion: LAUNCHER_VERSION,
    packVersion: VESPER_PACK_VERSION,
    username: os.userInfo().username,
    minecraft,
    pack,
    stats: statsSnapshot(),
    gameRunning,
    gameStartedAt: gameStartedAt ? gameStartedAt.toISOString() : null,
    rpc: { status: rpcStatus, error: rpcError },
    update: publicUpdateState(),
  };
}

function diagnosticsText(status) {
  const minecraft = status.minecraft || {};
  const pack = status.pack || {};
  return [
    `Vesper Launcher v${status.launcherVersion}`,
    `Vesper UI bundled: v${status.packVersion}`,
    `Vesper UI installed: ${pack.installedVersion || "none"}`,
    `Vesper UI status: ${pack.status || "unknown"}`,
    `Vesper UI copies: ${pack.copies ?? "unknown"}`,
    `Platform: ${status.platform}`,
    `Minecraft installed: ${minecraft.installed ? "yes" : "no"}`,
    `Minecraft version: ${minecraft.version || "unknown"}`,
    `Minecraft AppID: ${minecraft.appId || "unknown"}`,
    `Minecraft package: ${minecraft.packageFullName || minecraft.packageName || "unknown"}`,
    `Minecraft running: ${status.gameRunning ? "yes" : "no"}`,
    `Discord RPC: ${status.rpc?.status || "unknown"}`,
    `Launcher update: ${status.update?.status || "unknown"}${status.update?.version ? ` (${status.update.version})` : ""}`,
    `Tracked playtime: ${Math.round((status.stats?.totalPlaytimeMs || 0) / 1000)}s`,
    `Tracked sessions: ${status.stats?.sessionCount || 0}`,
  ].join("\n");
}

function packStatusLabel(pack) {
  return {
    installed: `Installed · v${pack.installedVersion}`,
    outdated: `Outdated · v${pack.installedVersion}`,
    newer: `Newer · v${pack.installedVersion}`,
    duplicates: `${pack.copies} copies detected`,
    missing: "Not installed",
    unavailable: "Unavailable",
  }[pack?.status] || "Unknown";
}

function updateTrayMenu(status) {
  if (!tray) return;
  const minecraft = status?.minecraft || {};
  const pack = status?.pack || {};
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: status?.gameRunning ? "Minecraft · Running" : minecraft.installed ? "Minecraft · Ready" : "Minecraft · Not found", enabled: false },
    { label: `Vesper UI · ${packStatusLabel(pack)}`, enabled: false },
    { label: `Discord · ${rpcStatus === "connected" ? "Connected" : rpcStatus}`, enabled: false },
    { type: "separator" },
    { label: "Launch Minecraft", enabled: Boolean(minecraft.installed && !status?.gameRunning), click: () => launchMinecraft().catch(() => {}) },
    { label: "Import / Repair Vesper UI", click: () => importVesperPack().catch(() => {}) },
    { label: "Show Vesper", click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { type: "separator" },
    { label: "Quit", click: () => { isQuitting = true; app.quit(); } },
  ]));
}

async function broadcastStatus() {
  const status = await getStatus();
  updateTrayMenu(status);
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("status:update", status);
  return status;
}

async function monitorMinecraft() {
  const running = await isMinecraftRunning();
  if (running === gameRunning) return;
  const wasRunning = gameRunning;
  gameRunning = running;
  if (running) beginGameSession();
  else finishGameSession();
  await broadcastStatus();
  await updateRpcActivity();
  if (wasRunning && !running && settings.restoreAfterExit && mainWindow) {
    mainWindow.show();
    mainWindow.restore();
    mainWindow.focus();
  }
}

function createTray() {
  const trayImage = nativeImage.createFromPath(path.join(__dirname, "..", "assets", "icon.png")).resize({ width: 20, height: 20 });
  tray = new Tray(trayImage);
  tray.setToolTip("Vesper Launcher");
  tray.on("double-click", () => { mainWindow?.show(); mainWindow?.focus(); });
}

function createWindow() {
  const startHidden = process.argv.includes("--hidden");
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 760,
    minWidth: 1060,
    minHeight: 650,
    frame: false,
    show: false,
    backgroundColor: "#0b0b10",
    icon: path.join(__dirname, "..", "assets", "icon.png"),
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  mainWindow.loadFile(path.join(__dirname, "index.html"));
  mainWindow.once("ready-to-show", () => { if (!startHidden) mainWindow.show(); });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url !== mainWindow.webContents.getURL()) event.preventDefault();
  });
  mainWindow.on("close", (event) => {
    if (!isQuitting && settings.closeToTray) { event.preventDefault(); mainWindow.hide(); }
  });
}

async function openExistingFolder(folder, message) {
  if (!folder || !fs.existsSync(folder)) throw new Error(message);
  const error = await shell.openPath(folder);
  if (error) throw new Error(error);
  return true;
}

function registerIpc() {
  ipcMain.handle("window:minimize", () => mainWindow?.minimize());
  ipcMain.handle("window:maximize", () => { if (mainWindow) mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize(); });
  ipcMain.handle("window:close", () => mainWindow?.close());
  ipcMain.handle("status:get", () => getStatus());
  ipcMain.handle("minecraft:launch", () => launchMinecraft());
  ipcMain.handle("minecraft:open-data", async () => {
    const minecraft = lastMinecraftInfo || await getMinecraftInfo();
    return openExistingFolder(minecraft.dataRoot, "Minecraft data folder was not found.");
  });
  ipcMain.handle("vesper:import-pack", () => importVesperPack());
  ipcMain.handle("vesper:show-pack", () => shell.showItemInFolder(bundledPackPath()));
  ipcMain.handle("vesper:open-installed-pack", async () => {
    const status = lastPackStatus || getPackStatus(lastMinecraftInfo || await getMinecraftInfo());
    return openExistingFolder(status.root, "Minecraft resource-pack folder was not found.");
  });
  ipcMain.handle("app:open-data", () => openExistingFolder(app.getPath("userData"), "Vesper data folder was not found."));
  ipcMain.handle("settings:get", () => settings);
  ipcMain.handle("settings:save", async (_event, nextSettings) => {
    const previousRpcEnabled = settings.rpcEnabled;
    saveSettings(nextSettings);
    applyStartupSetting();
    if (previousRpcEnabled !== settings.rpcEnabled) await connectRpc();
    return settings;
  });
  ipcMain.handle("setup:complete", () => saveSettings({ firstRunComplete: true }));
  ipcMain.handle("rpc:reconnect", async () => { await connectRpc(); return { status: rpcStatus, error: rpcError }; });
  ipcMain.handle("diagnostics:copy", async () => { const status = await getStatus(); clipboard.writeText(diagnosticsText(status)); return true; });
  ipcMain.handle("stats:reset", () => {
    if (gameRunning) throw new Error("Play statistics cannot be reset while Minecraft is running.");
    stats = { ...DEFAULT_STATS, recentSessions: [] };
    saveStats();
    return statsSnapshot();
  });
  ipcMain.handle("updates:get", () => publicUpdateState());
  ipcMain.handle("updates:check", () => checkForLauncherUpdate());
  ipcMain.handle("updates:install", () => installLauncherUpdate());
  ipcMain.handle("links:minecraft-download", () => shell.openExternal("https://www.minecraft.net/en-us/download"));
}

app.whenReady().then(async () => {
  loadSettings();
  loadStats();
  applyStartupSetting();
  registerIpc();
  createWindow();
  createTray();
  configureUpdater();
  gameRunning = await isMinecraftRunning();
  if (gameRunning) beginGameSession();
  await broadcastStatus();
  await connectRpc();
  monitorTimer = setInterval(() => monitorMinecraft().catch(() => {}), 4000);
});

app.on("before-quit", () => {
  isQuitting = true;
  if (monitorTimer) clearInterval(monitorTimer);
  if (updateTimer) clearInterval(updateTimer);
  if (gameRunning) finishGameSession();
  disconnectRpc().catch(() => {});
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && !settings.closeToTray) { isQuitting = true; app.quit(); }
});
