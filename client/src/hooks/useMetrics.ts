import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ClientMessage,
  ConfigInfo,
  ContainerList,
  HistoryPoint,
  HistorySeries,
  MetricsSnapshot,
  ProcessList,
  ServerMessage,
  StaticInfo,
  Topic,
} from "../types";

interface MetricsState {
  staticInfo: StaticInfo | null;
  config: ConfigInfo | null;
  metrics: MetricsSnapshot | null;
  processes: ProcessList | null;
  containers: ContainerList | null;
  history: HistorySeries | null;
  /** true between a range change and the server's answer */
  historyLoading: boolean;
  connected: boolean;
}

export interface MetricsApi extends MetricsState {
  setRefreshInterval: (intervalMs: number) => void;
  requestHistory: (rangeMs: number) => void;
}

const MAX_BACKOFF_MS = 5000;

const INITIAL_STATE: MetricsState = {
  staticInfo: null,
  config: null,
  metrics: null,
  processes: null,
  containers: null,
  history: null,
  historyLoading: false,
  connected: false,
};

/**
 * Single WebSocket connection to the server, with automatic reconnection.
 *
 * `topics` is what this viewer wants beyond the always-on metrics stream
 * (usually derived from the open tab): the server starts and stops those
 * collectors as viewers come and go.
 */
export function useMetrics(topics: readonly Topic[] = []): MetricsApi {
  const [state, setState] = useState<MetricsState>(INITIAL_STATE);
  const wsRef = useRef<WebSocket | null>(null);
  const backoff = useRef(500);

  // Kept in refs so a reconnection can replay them without re-running the
  // connection effect (which would tear the socket down).
  const topicsKey = [...topics].sort().join(",");
  const topicsRef = useRef(topicsKey);
  const historyRangeRef = useRef<number | null>(null);

  const send = useCallback((message: ClientMessage) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  }, []);

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
        // restore what this viewer was watching before the drop
        ws.send(JSON.stringify(currentTopicsMessage(topicsRef.current)));
        if (historyRangeRef.current !== null) {
          ws.send(
            JSON.stringify({
              type: "getHistory",
              rangeMs: historyRangeRef.current,
            } satisfies ClientMessage),
          );
        }
      };

      ws.onmessage = (event) => {
        const message = JSON.parse(event.data as string) as ServerMessage;
        setState((s) => reduce(s, message));
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

  useEffect(() => {
    topicsRef.current = topicsKey;
    send(currentTopicsMessage(topicsKey));
  }, [topicsKey, send]);

  const setRefreshInterval = useCallback(
    (intervalMs: number) => {
      // no optimistic update: the server echoes the effective (clamped)
      // value as a config message, which is the single source of truth
      send({ type: "setInterval", intervalMs });
    },
    [send],
  );

  const requestHistory = useCallback(
    (rangeMs: number) => {
      historyRangeRef.current = rangeMs;
      setState((s) => ({ ...s, historyLoading: true }));
      send({ type: "getHistory", rangeMs });
    },
    [send],
  );

  return useMemo(
    () => ({ ...state, setRefreshInterval, requestHistory }),
    [state, setRefreshInterval, requestHistory],
  );
}

function currentTopicsMessage(topicsKey: string): ClientMessage {
  return {
    type: "subscribe",
    topics: topicsKey ? (topicsKey.split(",") as Topic[]) : [],
  };
}

function reduce(state: MetricsState, message: ServerMessage): MetricsState {
  switch (message.type) {
    case "static":
      return { ...state, staticInfo: message.data };
    case "config":
      return { ...state, config: message.data };
    case "metrics":
      return {
        ...state,
        metrics: message.data,
        history: extend(state.history, message.data),
      };
    case "history":
      return { ...state, history: message.data, historyLoading: false };
    case "processes":
      return { ...state, processes: message.data };
    case "containers":
      return { ...state, containers: message.data };
  }
}

/**
 * Keeps the charts moving between history queries: once a live snapshot lands
 * in a bucket the series doesn't cover yet, it becomes the newest point and
 * anything that fell out of the window is dropped. Sampling at the bucket
 * width (rather than on every tick) keeps the density even across the chart.
 */
function extend(
  series: HistorySeries | null,
  snapshot: MetricsSnapshot,
): HistorySeries | null {
  if (!series) return series;

  const ts = Math.floor(snapshot.ts / series.bucketMs) * series.bucketMs;
  const last = series.points.at(-1);
  if (last && ts <= last.ts) return series;

  const point: HistoryPoint = {
    ts,
    cpu: snapshot.cpu.load,
    cpuTemp: snapshot.temperature.cpu,
    memUsed: snapshot.memory.used,
    memTotal: snapshot.memory.total,
    swapUsed: snapshot.memory.swapUsed,
    diskUsed: snapshot.disk.used,
    diskTotal: snapshot.disk.total,
    netRx: Math.round(snapshot.network.rxSec),
    netTx: Math.round(snapshot.network.txSec),
    fanRpm: snapshot.fan.rpm,
  };

  const cutoff = ts - series.rangeMs;
  const points = series.points.filter((p) => p.ts >= cutoff);
  points.push(point);

  return { ...series, from: points[0]?.ts ?? series.from, points };
}
