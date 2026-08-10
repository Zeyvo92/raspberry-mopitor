import { useEffect, useRef, useState } from "react";
import type { MetricsSnapshot, ServerMessage, StaticInfo } from "../types";

interface MetricsState {
  staticInfo: StaticInfo | null;
  metrics: MetricsSnapshot | null;
  connected: boolean;
}

const MAX_BACKOFF_MS = 5000;

/** Single WebSocket connection to the server, with automatic reconnection. */
export function useMetrics(): MetricsState {
  const [state, setState] = useState<MetricsState>({
    staticInfo: null,
    metrics: null,
    connected: false,
  });
  const backoff = useRef(500);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    let disposed = false;

    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${location.host}/ws`);

      ws.onopen = () => {
        backoff.current = 500;
        setState((s) => ({ ...s, connected: true }));
      };

      ws.onmessage = (event) => {
        const message = JSON.parse(event.data as string) as ServerMessage;
        if (message.type === "static") {
          setState((s) => ({ ...s, staticInfo: message.data }));
        } else {
          setState((s) => ({ ...s, metrics: message.data }));
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
      ws?.close();
    };
  }, []);

  return state;
}
