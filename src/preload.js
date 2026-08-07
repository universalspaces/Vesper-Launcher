const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("vesper", {
  window: {
    minimize: () => ipcRenderer.invoke("window:minimize"),
    maximize: () => ipcRenderer.invoke("window:maximize"),
    close: () => ipcRenderer.invoke("window:close"),
  },
  minecraft: {
    launch: () => ipcRenderer.invoke("minecraft:launch"),
    openData: () => ipcRenderer.invoke("minecraft:open-data"),
    importPack: () => ipcRenderer.invoke("vesper:import-pack"),
    showPack: () => ipcRenderer.invoke("vesper:show-pack"),
    openInstalledPack: () => ipcRenderer.invoke("vesper:open-installed-pack"),
  },
  status: {
    get: () => ipcRenderer.invoke("status:get"),
    subscribe: (callback) => {
      const handler = (_event, status) => callback(status);
      ipcRenderer.on("status:update", handler);
      return () => ipcRenderer.removeListener("status:update", handler);
    },
  },
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    save: (settings) => ipcRenderer.invoke("settings:save", settings),
  },
  setup: {
    complete: () => ipcRenderer.invoke("setup:complete"),
  },
  rpc: {
    reconnect: () => ipcRenderer.invoke("rpc:reconnect"),
  },
  diagnostics: {
    copy: () => ipcRenderer.invoke("diagnostics:copy"),
  },
  stats: {
    reset: () => ipcRenderer.invoke("stats:reset"),
  },
  updates: {
    check: () => ipcRenderer.invoke("updates:check"),
    get: () => ipcRenderer.invoke("updates:get"),
    install: () => ipcRenderer.invoke("updates:install"),
    subscribe: (callback) => {
      const handler = (_event, status) => callback(status);
      ipcRenderer.on("updates:status", handler);
      return () => ipcRenderer.removeListener("updates:status", handler);
    },
  },
  app: {
    openData: () => ipcRenderer.invoke("app:open-data"),
  },
  links: {
    minecraftDownload: () => ipcRenderer.invoke("links:minecraft-download"),
  },
});
