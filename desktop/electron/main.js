const { app, BrowserWindow, ipcMain, shell } = require('electron')
const { join } = require('path')
const net = require('net')
const os = require('os')
const http = require('http')
const https = require('https')
const crypto = require('crypto')
const { WebSocketServer } = require('ws')

const isDev = process.env.NODE_ENV === 'development'

// ── Local network server (HTTP proxy + WebSocket) ─────────────────────────────
// Mobile devices point their base URL at http://192.168.x.x:8765/api/v1 and
// connect their WS to ws://192.168.x.x:8765. The desktop:
//   - relays cloud kitchen events to connected mobile clients over WS
//   - transparently proxies REST requests to the cloud API, so mobile devices
//     on the LAN don't need direct internet access / cloud URL configuration
//
// Anyone on the LAN can otherwise reach this port, so every request/connection
// must present the pairing token shown in the desktop UI (LocalWsBadge) — the
// restaurant owner types it into the mobile app's "local desktop" settings once.

const LOCAL_WS_PORT = 8765
let localHttpServer = null
let localWsServer = null
const localClients = new Set()
let cloudServerUrl = null // e.g. "http://api.marjon.uz/api/v1", set via IPC from renderer
const pairingToken = crypto.randomBytes(16).toString('hex')

function getLocalIp() {
  for (const iface of Object.values(os.networkInterfaces())) {
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address
    }
  }
  return '127.0.0.1'
}

function tokenFromRequest(req, requestUrl) {
  return req.headers['x-local-token'] || requestUrl.searchParams.get('token')
}

function proxyToCloud(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
  if (tokenFromRequest(req, requestUrl) !== pairingToken) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ detail: 'Desktop proxy: invalid pairing token' }));
    return;
  }

  if (!cloudServerUrl) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ detail: 'Desktop proxy: cloud server not configured' }));
    return;
  }

  const origin = cloudServerUrl.replace(/\/api\/v1\/?$/, '');
  const target = new URL(origin + requestUrl.pathname + requestUrl.search.replace(/[?&]token=[^&]*/, ''));
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
  if (localHttpServer) return { ip: getLocalIp(), port: LOCAL_WS_PORT, token: pairingToken }

  localHttpServer = http.createServer(proxyToCloud)
  localWsServer = new WebSocketServer({
    server: localHttpServer,
    verifyClient: ({ req }) => {
      const requestUrl = new URL(req.url, 'http://localhost')
      return requestUrl.searchParams.get('token') === pairingToken
    },
  })

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
  console.log(`[LocalWS] Listening on ws://${getLocalIp()}:${LOCAL_WS_PORT} (+ REST proxy), pairing token required`)
  return { ip: getLocalIp(), port: LOCAL_WS_PORT, token: pairingToken }
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

function printRaw(ip, port, data, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(port, ip, () => {
      socket.write(data, (err) => {
        socket.end()
        if (err) reject(new Error(`Write error: ${err.message}`))
        else resolve()
      })
    })
    socket.setTimeout(timeout)
    socket.on('timeout', () => { socket.destroy(); reject(new Error(`Timeout ${ip}:${port}`)) })
    socket.on('error', (err) => reject(new Error(`${ip}:${port} — ${err.message}`)))
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

app.whenReady().then(() => {
  // Start local WS server immediately so mobile devices can connect
  startLocalWsServer()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  stopLocalWsServer()
  if (process.platform !== 'darwin') app.quit()
})

// ── IPC: Printing ─────────────────────────────────────────────────────────────

ipcMain.handle('printer:print', async (_event, { ip, port, payloadBase64, copies = 1 }) => {
  const raw = Buffer.from(payloadBase64, 'base64')
  for (let i = 0; i < copies; i++) {
    await printRaw(ip, port ?? 9100, raw)
  }
})

ipcMain.handle('printer:ping', async (_event, { ip, port }) => {
  return await pingPrinter(ip, port ?? 9100)
})

// ── IPC: Local WebSocket server ───────────────────────────────────────────────

ipcMain.handle('localws:info', () => ({
  ip: getLocalIp(),
  port: LOCAL_WS_PORT,
  token: pairingToken,
  clients: localClients.size,
  running: localWsServer !== null,
}))

ipcMain.handle('localws:broadcast', (_event, { event, data }) => {
  broadcastLocal(event, data)
})

ipcMain.handle('localws:set-server-url', (_event, url) => {
  cloudServerUrl = url || null
})
