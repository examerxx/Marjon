const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electron', {
  // ── Printing ────────────────────────────────────────────────────────────────
  print: (args) => ipcRenderer.invoke('printer:print', args),
  pingPrinter: (args) => ipcRenderer.invoke('printer:ping', args),

  // ── Window controls (existing) ───────────────────────────────────────────────
  minimize: () => ipcRenderer.invoke('window:minimize'),
  toggleFullscreen: () => ipcRenderer.invoke('window:toggleFullscreen'),
  setKiosk: (enabled) => ipcRenderer.invoke('window:setKiosk', enabled),
  isFullscreen: () => ipcRenderer.invoke('window:isFullscreen'),

  // ── Window controls (new) ────────────────────────────────────────────────────
  setFullScreen: (enabled) => ipcRenderer.invoke('window:setFullScreen', enabled),

  // ── PIN-protected exit ───────────────────────────────────────────────────────
  setLocked: (locked) => ipcRenderer.invoke('window:setLocked', locked),
  allowCloseOnce: () => ipcRenderer.invoke('window:allowCloseOnce'),
  // Register a callback for when the main process wants the renderer to show a PIN dialog
  onRequestExitPin: (callback) => {
    ipcRenderer.on('request-exit-pin', (_event) => callback())
  },

  // ── Zoom ─────────────────────────────────────────────────────────────────────
  zoomIn: () => ipcRenderer.invoke('window:zoomIn'),
  zoomOut: () => ipcRenderer.invoke('window:zoomOut'),
  setZoom: (factor) => ipcRenderer.invoke('window:setZoom', factor),
  getZoom: () => ipcRenderer.invoke('window:getZoom'),

  // ── Auto-launch ──────────────────────────────────────────────────────────────
  setAutoLaunch: (enabled) => ipcRenderer.invoke('app:setAutoLaunch', enabled),

  // ── Local network WebSocket server ───────────────────────────────────────────
  // Mobile devices connect to ws://{ip}:{port} on the LAN.
  localWS: {
    /** Returns { ip, port, token, clients, running } */
    info: () => ipcRenderer.invoke('localws:info'),
    /** Broadcast a kitchen event to all connected mobile clients. */
    broadcast: (event, data) => ipcRenderer.invoke('localws:broadcast', { event, data }),
    /** Tell the local proxy which cloud API base URL to forward REST requests to. */
    setServerUrl: (url) => ipcRenderer.invoke('localws:set-server-url', url),
  },
})
