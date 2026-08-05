// Хук подписки на WebSocket-события.
// Использование:
//   useWebSocket("order.created", (data) => setOrders(prev => [data, ...prev]));

import { useEffect, useRef } from "react";
import { getWsConnection } from "../api/ws";

export function useWebSocket(event, handler, options = {}) {
  const { path = "/ws", enabled = true } = options;
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    if (!enabled) return undefined;
    const conn = getWsConnection(path);
    conn.connect();
    const off = conn.on(event, (data) => handlerRef.current?.(data));
    return () => {
      off();
    };
  }, [event, path, enabled]);
}

// Хук возвращает объект соединения для send / on / off / disconnect.
export function useWebSocketConnection(path = "/ws") {
  const connRef = useRef(null);
  if (!connRef.current) {
    connRef.current = getWsConnection(path);
  }
  useEffect(() => {
    connRef.current.connect();
  }, []);
  return connRef.current;
}
