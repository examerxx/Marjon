const { contextBridge, ipcRenderer } = require('electron')

// ── Офлайн-режим ─────────────────────────────────────────────────────────────
// Основной процесс отвечает { ok, data } | { ok: false, error, status, network }.
// Рендерер работает с обычными промисами/ошибками axios-подобной формы, чтобы
// офлайн-путь не растекался по UI отдельными обработчиками.
function offlineCall(channel, ...args) {
  return ipcRenderer.invoke(channel, ...args).then((res) => {
    if (res && res.ok) return res.data
    const error = new Error(res?.error || 'offline error')
    error.status = res?.status ?? null
    error.network = !!res?.network
    error.offline = true
    throw error
  })
}

const offline = {
  configure: (cfg) => offlineCall('offline:configure', cfg),
  status: () => offlineCall('offline:status'),
  syncNow: () => offlineCall('offline:sync-now'),
  bootstrap: () => offlineCall('offline:bootstrap'),
  changes: () => offlineCall('offline:changes'),
  flush: () => offlineCall('offline:flush'),
  cache: (key, data) => offlineCall('offline:cache', key, data),
  cacheGet: (key) => offlineCall('offline:cache-get', key),

  staffUsers: (branchId) => offlineCall('offline:staff-users', branchId),
  verifyPin: (pin, userId) => offlineCall('offline:verify-pin', pin, userId),
  userByToken: (token) => offlineCall('offline:user-by-token', token),

  shiftCurrent: (branchId, userId) => offlineCall('offline:shift-current', branchId, userId),
  shiftOpen: (branchId, openingCash, userId) => offlineCall('offline:shift-open', branchId, openingCash, userId),
  shiftClose: (branchId, closingCash, userId) => offlineCall('offline:shift-close', branchId, closingCash, userId),

  listOrders: (params) => offlineCall('offline:orders-list', params),
  getOrder: (id) => offlineCall('offline:order-get', id),
  hasOrder: (id) => offlineCall('offline:has-order', id),
  createOrder: (payload) => offlineCall('offline:order-create', payload),
  addItems: (orderId, items) => offlineCall('offline:order-add-items', orderId, items),
  setItemQty: (orderId, itemId, quantity) => offlineCall('offline:order-set-qty', orderId, itemId, quantity),
  removeItem: (orderId, itemId, reason) => offlineCall('offline:order-remove-item', orderId, itemId, reason),
  updateOrder: (orderId, patch, options) => offlineCall('offline:order-update', orderId, patch, options),
  cancelOrder: (orderId, options) => offlineCall('offline:order-cancel', orderId, options),
  updateStatus: (orderId, status, extra) => offlineCall('offline:order-status', orderId, status, extra),
  payOrder: (orderId, payment) => offlineCall('offline:order-pay', orderId, payment),
  paymentsForOrder: (orderId) => offlineCall('offline:payments-for-order', orderId),

  printReceipt: (args) => offlineCall('offline:print-receipt', args),
  printKitchen: (args) => offlineCall('offline:print-kitchen', args),

  onState: (callback) => {
    const listener = (_event, state) => callback(state)
    ipcRenderer.on('offline:state', listener)
    return () => ipcRenderer.removeListener('offline:state', listener)
  },
}

contextBridge.exposeInMainWorld('electron', {
  // ── Printing ────────────────────────────────────────────────────────────────
  print: (args) => ipcRenderer.invoke('printer:print', args),
  pingPrinter: (args) => ipcRenderer.invoke('printer:ping', args),
  openDrawer: (args) => ipcRenderer.invoke('printer:openDrawer', args),

  // ── Offline (SQLite + outbox) ───────────────────────────────────────────────
  offline,

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
})
