/**
 * Marjon Desktop — WebSocket сервис для кухни
 * Real-time подключение к серверу для мгновенного получения заказов
 */

const WS_RECONNECT_DELAY = 3000
const WS_PING_INTERVAL = 15000
const WS_PONG_TIMEOUT = 30000

class KitchenWS {
  constructor() {
    this._socket = null
    this._reconnectTimer = null
    this._pingTimer = null
    this._pongTimer = null
    this._listeners = new Map()
    this._connected = false
    this._params = null
  }

  get isConnected() {
    return this._connected
  }

  connect(serverUrl, token, branchId) {
    this._params = { serverUrl, token, branchId }
    this._doConnect()
  }

  _doConnect() {
    if (!this._params) return
    this.disconnect(false)

    const { serverUrl, token, branchId } = this._params
    const wsUrl = serverUrl.replace(/^http/, 'ws').replace(/\/api\/v1\/?$/, '')
    const url = `${wsUrl}/ws/kitchen?token=${token}&branch_id=${branchId}`

    try {
      this._socket = new WebSocket(url)
    } catch (e) {
      this._scheduleReconnect()
      return
    }

    this._socket.onopen = () => {
      this._connected = true
      this._emit('connection', { status: 'online' })
      this._startPing()
    }

    this._socket.onmessage = (event) => {
      if (event.data === 'pong') {
        this._handlePong()
        return
      }
      try {
        const msg = JSON.parse(event.data)
        this._emit(msg.type, msg.data)
      } catch {
        // non-JSON frame
      }
    }

    this._socket.onclose = () => {
      this._connected = false
      this._stopPing()
      this._emit('connection', { status: 'offline' })
      this._scheduleReconnect()
    }

    this._socket.onerror = () => {
      this._connected = false
      this._emit('connection', { status: 'error' })
    }
  }

  disconnect(clearParams = true) {
    clearTimeout(this._reconnectTimer)
    this._stopPing()
    if (this._socket) {
      this._socket.onclose = null
      this._socket.onerror = null
      this._socket.close()
      this._socket = null
    }
    this._connected = false
    if (clearParams) this._params = null
  }

  on(event, callback) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set())
    }
    this._listeners.get(event).add(callback)
    return () => this._listeners.get(event)?.delete(callback)
  }

  _emit(event, data) {
    const callbacks = this._listeners.get(event)
    if (callbacks) {
      callbacks.forEach(cb => {
        try { cb(data) } catch (e) { console.error('[KitchenWS] listener error:', e) }
      })
    }
  }

  _startPing() {
    this._pingTimer = setInterval(() => {
      if (this._socket?.readyState === WebSocket.OPEN) {
        this._socket.send('ping')
        this._pongTimer = setTimeout(() => {
          this._socket?.close()
        }, WS_PONG_TIMEOUT)
      }
    }, WS_PING_INTERVAL)
  }

  _stopPing() {
    clearInterval(this._pingTimer)
    clearTimeout(this._pongTimer)
  }

  _handlePong() {
    clearTimeout(this._pongTimer)
  }

  _scheduleReconnect() {
    clearTimeout(this._reconnectTimer)
    this._reconnectTimer = setTimeout(() => this._doConnect(), WS_RECONNECT_DELAY)
  }
}

export const kitchenWS = new KitchenWS()
