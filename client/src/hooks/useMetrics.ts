import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ClientMessage,
  ConfigInfo,
  MetricsSnapshot,
  ServerMessage,
  StaticInfo,
} from "../types";

interface MetricsState {
  staticInfo: StaticInfo | null;
  config: ConfigInfo | null;
  metrics: MetricsSnapshot | null;
  connected: boolean;
}

const MAX_BACKOFF_MS = 5000;

/** Single WebSocket connection to the server, with automatic reconnection. */
export function useMetrics(): MetricsState & {
  setRefreshInterval: (intervalMs: number) => void;
} {
  const [state, setState] = useState<MetricsState>({
    staticInfo: null,
    config: null,
    metrics: null,
    connected: false,
  });
  const backoff = useRef(500);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let reconnectTimer: number | undefined;
    let disposed = false;

    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        backoff.current = 500;
        setState((s) => ({ ...s, connected: true }));
      };

      ws.onmessage = (event) => {
        const message = JSON.parse(event.data as string) as ServerMessage;
        switch (message.type) {
          case "static":
            setState((s) => ({ ...s, staticInfo: message.data }));
            break;
          case "config":
            setState((s) => ({ ...s, config: message.data }));
            break;
          case "metrics":
            setState((s) => ({ ...s, metrics: message.data }));
            break;
        }
      };

      ws.onclose = () => {
        if (disposed) return;
        setState((s) => ({ ...s, connected: false }));
        reconnectTimer = window.setTimeout(connect, backoff.current);
        backoff.current = Math.min(backoff.current * 2, MAX_BACKOFF_MS);
      };
    };

    connect();

    return () => {
      disposed = true;
      window.clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, []);

  const setRefreshInterval = useCallback((intervalMs: number) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      const message: ClientMessage = { type: "setInterval", intervalMs };
      ws.send(JSON.stringify(message));
      // no optimistic update: the server echoes the effective (clamped)
      // value as a config message, which is the single source of truth
    }
  }, []);

  return { ...state, setRefreshInterval };
}
