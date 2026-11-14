const { app, BrowserWindow, ipcMain, shell, session } = require('electron')
const { join } = require('path')
const net = require('net')
const os = require('os')
const http = require('http')
const https = require('https')
const { WebSocketServer } = require('ws')
const { initOffline } = require('./offline')

const isDev = process.env.NODE_ENV === 'development' || !!process.env['ELECTRON_RENDERER_URL']

// ── GPU в основном процессе (для VM / окружений без рабочего GPU) ────────────
// В виртуализованных средах дочерний GPU-процесс падает с access violation
// (0xC0000005) и Electron завершается с "GPU process isn't usable. Goodbye."
// Флаг переносит GPU в основной процесс. Включается только по явной просьбе,
// по умолчанию поведение не меняется.
if (process.env.MARJON_IN_PROCESS_GPU === '1') {
  app.commandLine.appendSwitch('in-process-gpu')
  app.commandLine.appendSwitch('disable-gpu-compositing')
}

// ── Allow external CDP clients ────────────────────────────────────────────────
// Newer Electron rejects WebSocket CDP connections whose Origin header is not
// allowed. When MARJON_DEV_CDP_ALLOW=1, permit any origin so the local cdp-*
// helper scripts can drive the renderer for diagnostics (screenshots, localStorage,
// fetch). No effect on production builds.
if (process.env.MARJON_DEV_CDP_ALLOW === '1') {
  app.commandLine.appendSwitch('remote-allow-origins', '*')
}

// ── Single-instance lock ──────────────────────────────────────────────────────
// В dev не завершаем процесс при отсутствии лока (electron-vite может перезапускать),
// чтобы окно не закрывалось внезапно. В проде — стандартный single-instance.

const gotLock = app.requestSingleInstanceLock()
if (!gotLock && !isDev) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

// ── PIN-protected close flag ──────────────────────────────────────────────────

// In dev we default to unlocked so the window can be closed normally.
let allowClose = true   // becomes false when renderer calls window:setLocked(true)
let allowCloseOnce = false

// ── Local network server (HTTP proxy + WebSocket) ─────────────────────────────
// Mobile devices point their base URL at http://192.168.x.x:8765/api/v1 and
// connect their WS to ws://192.168.x.x:8765. The desktop:
//   - relays cloud kitchen events to connected mobile clients over WS
//   - transparently proxies REST requests to the cloud API, so mobile devices
//     on the LAN don't need direct internet access / cloud URL configuration

const LOCAL_WS_PORT = 8765
let localHttpServer = null
let localWsServer = null
const localClients = new Set()
let cloudServerUrl = null // e.g. "http://api.marjon.uz/api/v1", set via IPC from renderer

function getLocalIp() {
  for (const iface of Object.values(os.networkInterfaces())) {
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address
    }
  }
  return '127.0.0.1'
}

function proxyToCloud(req, res) {
  if (!cloudServerUrl) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ detail: 'Desktop proxy: cloud server not configured' }));
    return;
  }

  const origin = cloudServerUrl.replace(/\/api\/v1\/?$/, '');
  const target = new URL(origin + req.url);
  const client = target.protocol === 'https:' ? https : http;

  const upstream = client.request(target, {
    method: req.method,
    headers: { ...req.headers, host: target.host },
  }, (upstreamRes) => {
    res.writeHead(upstreamRes.statusCode, upstreamRes.headers);
    upstreamRes.pipe(res);
  });

  upstream.on('error', () => {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ detail: 'Desktop proxy: cloud unreachable' }));
  });

  req.pipe(upstream);
}

function startLocalWsServer() {
  if (localHttpServer) return { ip: getLocalIp(), port: LOCAL_WS_PORT }

  localHttpServer = http.createServer(proxyToCloud)
  localWsServer = new WebSocketServer({ server: localHttpServer })

  localWsServer.on('connection', (ws) => {
    localClients.add(ws)
    // Inform the mobile client it's connected
    ws.send(JSON.stringify({ event: '__connected__', data: { port: LOCAL_WS_PORT } }))
    ws.on('close',  () => localClients.delete(ws))
    ws.on('error',  () => localClients.delete(ws))
    // Keepalive pong
    ws.on('message', (msg) => { if (msg.toString() === 'ping') ws.send('pong') })
  })

  localHttpServer.listen(LOCAL_WS_PORT)
  console.log(`[LocalWS] Listening on ws://${getLocalIp()}:${LOCAL_WS_PORT} (+ REST proxy)`)
  return { ip: getLocalIp(), port: LOCAL_WS_PORT }
}

function stopLocalWsServer() {
  localWsServer?.close()
  localWsServer = null
  localHttpServer?.close()
  localHttpServer = null
  localClients.clear()
}

function broadcastLocal(event, data) {
  const msg = JSON.stringify({ event, data })
  for (const ws of localClients) {
    if (ws.readyState === 1 /* OPEN */) ws.send(msg)
  }
}

// ── Printer TCP helpers ───────────────────────────────────────────────────────

// PRINT-QUEUE-01: дешёвые ESC/POS-принтеры не держат несколько параллельных
// соединений — при быстрых кликах «Печать чека» открывалось несколько сокетов
// сразу, часть из них принтер молча проглатывал. Все задания идут строго
// по одному: следующее стартует после закрытия предыдущего.
let printChain = Promise.resolve()
function enqueuePrint(task) {
  const run = printChain.then(task, task)
  printChain = run.then(() => undefined, () => undefined)
  return run
}

function printRaw(ip, port, data, timeout = 5000) {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (err) => {
      if (settled) return
      settled = true
      try { socket.setTimeout(0) } catch (_) {}
      try { socket.destroy() } catch (_) {}
      if (err) reject(err)
      else resolve()
    }
    const socket = net.createConnection(port, ip, () => {
      socket.write(data, (err) => {
        if (err) return finish(new Error(`Write error: ${err.message}`))
        // end() + 'finish' = байты реально отданы в ОС. Раньше сокет рвался
        // прямо в колбэке write(), и на медленном принтере чек обрезался.
        socket.end()
      })
    })
    socket.setTimeout(timeout)
    socket.on('finish', () => finish())
    socket.on('close', () => finish())
    socket.on('timeout', () => finish(new Error(`Timeout ${ip}:${port}`)))
    socket.on('error', (err) => finish(new Error(`${ip}:${port} — ${err.message}`)))
  })
}

function pingPrinter(ip, port = 9100) {
  return new Promise((resolve) => {
    const socket = net.createConnection(port, ip, () => { socket.end(); resolve(true) })
    socket.setTimeout(3000)
    socket.on('timeout', () => { socket.destroy(); resolve(false) })
    socket.on('error', () => resolve(false))
  })
}

// ── Window ────────────────────────────────────────────────────────────────────

let mainWindow

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())

  // PIN-protected close: intercept 'close' when locked
  mainWindow.on('close', (e) => {
    if (allowCloseOnce) {
      allowCloseOnce = false  // consume the one-shot flag
      return                  // allow close
    }
    if (!allowClose) {
      e.preventDefault()
      try {
        mainWindow.webContents.send('request-exit-pin')
      } catch (_) {}
    }
    // if allowClose === true, fall through → normal close
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ── Dev CORS rewrite ─────────────────────────────────────────────────────────
// Бэкенд api.marjon.tech держит в CORS-whitelist единственный origin
// https://marjon.tech. Рендерер в dev-режиме живёт на http://localhost:5174,
// поэтому браузер отбрасывает ответы ("Disallowed CORS origin"), и подключиться
// к бэкенду по прямому адресу невозможно — даже если адрес введён верно.
//
// Здесь на уровне сессии исходящий Origin подменяется на разрешённый, а в ответ
// возвращается настоящий origin рендерера. Включается только переменной
// окружения MARJON_DEV_CORS_REWRITE=1 и только для dev. В проде не применяется.
function installDevCorsRewrite() {
  const TARGET = 'api.marjon.tech'
  const ALLOWED_ORIGIN = 'https://marjon.tech'
  const rendererOrigin = (() => {
    try {
      return new URL(process.env['ELECTRON_RENDERER_URL'] || 'http://localhost:5174').origin
    } catch {
      return 'http://localhost:5174'
    }
  })()

  const ses = session.defaultSession

  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = { ...details.requestHeaders }
    if (details.url.includes(TARGET)) {
      // Убираем все варианты написания, чтобы не получить дубль заголовка
      for (const key of Object.keys(headers)) {
        if (key.toLowerCase() === 'origin') delete headers[key]
      }
      headers['Origin'] = ALLOWED_ORIGIN
    }
    callback({ requestHeaders: headers })
  })

  ses.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders }
    if (!details.url.includes(TARGET)) return callback({ responseHeaders: headers })
    for (const key of Object.keys(headers)) {
      const k = key.toLowerCase()
      if (k === 'access-control-allow-origin' || k === 'access-control-allow-credentials') {
        delete headers[key]
      }
    }
    headers['Access-Control-Allow-Origin'] = [rendererOrigin]
    headers['Access-Control-Allow-Credentials'] = ['true']
    callback({ responseHeaders: headers })
  })
}

app.whenReady().then(() => {
  // Start local WS server immediately so mobile devices can connect
  startLocalWsServer()

  // Офлайн-слой: локальная SQLite, очередь записи и печать без сети.
  // Инициализируется до окна — рендерер уже на первом рендере видит статус.
  try {
    initOffline({
      app,
      ipcMain,
      getWindow: () => mainWindow,
      enqueuePrint,
      printRaw,
    })
  } catch (err) {
    console.error('[offline] init failed:', err)
  }

  // Dev-only: разрешить рендереру ходить в бэкенд, которого нет в его CORS-whitelist
  if (process.env.MARJON_DEV_CORS_REWRITE === '1') installDevCorsRewrite()

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  // ── Auto-update (production only) ────────────────────────────────────────
  if (!isDev) {
    try {
      const { autoUpdater } = require('electron-updater')
      Promise.resolve(autoUpdater.checkForUpdatesAndNotify()).catch(() => {})
    } catch (_) {
      // electron-updater not available — silently skip
    }
  }
})

app.on('window-all-closed', () => {
  stopLocalWsServer()
  if (process.platform !== 'darwin') app.quit()
})

// ── IPC: Window controls ──────────────────────────────────────────────────────

ipcMain.handle('window:minimize', () => {
  if (mainWindow) mainWindow.minimize()
})

ipcMain.handle('window:toggleFullscreen', () => {
  if (!mainWindow) return
  mainWindow.setFullScreen(!mainWindow.isFullScreen())
})

ipcMain.handle('window:setKiosk', (_event, enabled) => {
  if (!mainWindow) return
  mainWindow.setKiosk(enabled)
})

ipcMain.handle('window:isFullscreen', () => {
  return mainWindow ? mainWindow.isFullScreen() : false
})

// New: set fullscreen explicitly
ipcMain.handle('window:setFullScreen', (_event, enabled) => {
  try {
    if (mainWindow) mainWindow.setFullScreen(!!enabled)
  } catch (e) {}
})

// ── IPC: PIN-protected exit ───────────────────────────────────────────────────

ipcMain.handle('window:setLocked', (_event, locked) => {
  try {
    allowClose = !locked
  } catch (e) {}
})

ipcMain.handle('window:allowCloseOnce', () => {
  try {
    allowCloseOnce = true
    if (mainWindow) mainWindow.close()
  } catch (e) {}
})

// ── IPC: Zoom ─────────────────────────────────────────────────────────────────

const ZOOM_MIN = 0.75
const ZOOM_MAX = 1.5

ipcMain.handle('window:zoomIn', () => {
  try {
    if (!mainWindow) return
    const current = mainWindow.webContents.getZoomFactor()
    const next = Math.min(ZOOM_MAX, Math.round((current + 0.1) * 100) / 100)
    mainWindow.webContents.setZoomFactor(next)
    return next
  } catch (e) {}
})

ipcMain.handle('window:zoomOut', () => {
  try {
    if (!mainWindow) return
    const current = mainWindow.webContents.getZoomFactor()
    const next = Math.max(ZOOM_MIN, Math.round((current - 0.1) * 100) / 100)
    mainWindow.webContents.setZoomFactor(next)
    return next
  } catch (e) {}
})

ipcMain.handle('window:setZoom', (_event, factor) => {
  try {
    if (!mainWindow) return
    const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, factor))
    mainWindow.webContents.setZoomFactor(clamped)
    return clamped
  } catch (e) {}
})

ipcMain.handle('window:getZoom', () => {
  try {
    return mainWindow ? mainWindow.webContents.getZoomFactor() : 1
  } catch (e) { return 1 }
})

// ── IPC: Auto-launch ──────────────────────────────────────────────────────────

ipcMain.handle('app:setAutoLaunch', (_event, enabled) => {
  try {
    app.setLoginItemSettings({ openAtLogin: !!enabled })
  } catch (e) {}
})

// ── IPC: Printing ─────────────────────────────────────────────────────────────

ipcMain.handle('printer:print', async (_event, { ip, port, payloadBase64, copies = 1 }) => {
  const raw = Buffer.from(payloadBase64, 'base64')
  // Очередь: параллельные вызовы (быстрые клики, WS-задание + ручная печать)
  // не должны открывать несколько сокетов к одному принтеру одновременно.
  return enqueuePrint(async () => {
    for (let i = 0; i < copies; i++) {
      await printRaw(ip, port ?? 9100, raw)
    }
  })
})

ipcMain.handle('printer:ping', async (_event, { ip, port }) => {
  return await pingPrinter(ip, port ?? 9100)
})

// ── IPC: Cash drawer ──────────────────────────────────────────────────────────
// ESC/POS команда открытия денежного ящика (Drawer Kick).
// Пин 2 (0x00), импульс 50 мс (0x19 × 2 мс), пауза 500 мс (0xFA × 2 мс).
// Работает на 99% ESC/POS-принтеров (XPrinter, Epson, Gainscha и т.д.).
const DRAWER_KICK = Buffer.from([0x1B, 0x70, 0x00, 0x19, 0xFA])

ipcMain.handle('printer:openDrawer', async (_event, { ip, port }) => {
  if (!ip) throw new Error('No printer IP')
  return enqueuePrint(async () => {
    await printRaw(ip, port ?? 9100, DRAWER_KICK)
  })
})

// ── IPC: Local WebSocket server ───────────────────────────────────────────────

ipcMain.handle('localws:info', () => ({
  ip: getLocalIp(),
  port: LOCAL_WS_PORT,
  clients: localClients.size,
  running: localWsServer !== null,
}))

ipcMain.handle('localws:broadcast', (_event, { event, data }) => {
  broadcastLocal(event, data)
})

ipcMain.handle('localws:set-server-url', (_event, url) => {
  cloudServerUrl = url || null
})
