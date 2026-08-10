import { formatUptime } from "../format";
import type { ConfigInfo, StaticInfo } from "../types";
import { RefreshControl } from "./RefreshControl";

export function SystemHeader({
  info,
  config,
  uptime,
  connected,
  onChangeInterval,
}: {
  info: StaticInfo | null;
  config: ConfigInfo | null;
  uptime: number | null;
  connected: boolean;
  onChangeInterval: (intervalMs: number) => void;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
      <div>
        <h1 className="text-xl font-bold text-zinc-100">
          {info?.hostname ?? "raspberry-mopitor"}
          <span
            className={`ml-2 inline-block h-2.5 w-2.5 rounded-full align-middle ${
              connected ? "bg-emerald-500" : "bg-red-500 animate-pulse"
            }`}
            title={connected ? "connected" : "disconnected"}
          />
        </h1>
        {info && (
          <p className="mt-1 text-xs text-zinc-500">
            {info.model} · {info.os} · {info.kernel} ({info.arch})
          </p>
        )}
      </div>
      <div className="flex items-center gap-4">
        {config && <RefreshControl config={config} onChange={onChangeInterval} />}
        {uptime !== null && (
          <p className="text-xs text-zinc-500">
            up <span className="font-mono text-zinc-300">{formatUptime(uptime)}</span>
          </p>
        )}
      </div>
    </header>
  );
}
