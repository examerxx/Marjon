// WebSocket клиент с reconnect и подписками.
// Используется хуком useWebSocket и напрямую при необходимости.

import { API_BASE_URL, getAccessToken } from "./client";

function buildWsUrl(path) {
  try {
    const url = new URL(API_BASE_URL);
    const proto = url.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${url.host}${path}`;
  } catch {
    return path;
  }
}

class WSConnection {
  constructor(path) {
    this.path = path;
    this.socket = null;
    this.listeners = new Map(); // event -> Set<callback>
    this.reconnectAttempts = 0;
    this.shouldReconnect = true;
    this.reconnectTimer = null;
    this.openHandlers = new Set();
    this.closeHandlers = new Set();
  }

  connect() {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }
    const token = getAccessToken();
    const url = buildWsUrl(this.path) + (token ? `?token=${encodeURIComponent(token)}` : "");

    try {
      this.socket = new WebSocket(url);
    } catch (e) {
      this.scheduleReconnect();
      return;
    }

    this.socket.onopen = () => {
      this.reconnectAttempts = 0;
      this.openHandlers.forEach((cb) => cb());
    };

    this.socket.onmessage = (event) => {
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }
      const eventName = payload?.event || payload?.type || "message";
      const handlers = this.listeners.get(eventName);
      if (handlers) {
        handlers.forEach((cb) => cb(payload.data ?? payload));
      }
      const wildcard = this.listeners.get("*");
      if (wildcard) {
        wildcard.forEach((cb) => cb(payload));
      }
    };

    this.socket.onclose = () => {
      this.closeHandlers.forEach((cb) => cb());
      if (this.shouldReconnect) this.scheduleReconnect();
    };

    this.socket.onerror = () => {
      // onclose сработает следом
    };
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    const delay = Math.min(30000, 1000 * 2 ** Math.min(this.reconnectAttempts, 5));
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  on(event, callback) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    const set = this.listeners.get(event);
    if (set) set.delete(callback);
  }

  onOpen(cb) {
    this.openHandlers.add(cb);
    return () => this.openHandlers.delete(cb);
  }

  onClose(cb) {
    this.closeHandlers.add(cb);
    return () => this.closeHandlers.delete(cb);
  }

  send(eventOrPayload, data) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    const payload = typeof eventOrPayload === "string" ? { event: eventOrPayload, data } : eventOrPayload;
    this.socket.send(JSON.stringify(payload));
    return true;
  }

  disconnect() {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }
}

// Кэш одного соединения на путь
const connections = new Map();

export function getWsConnection(path = "/ws") {
  if (!connections.has(path)) {
    connections.set(path, new WSConnection(path));
  }
  return connections.get(path);
}

export function closeAllConnections() {
  connections.forEach((c) => c.disconnect());
  connections.clear();
}
