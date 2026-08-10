import { formatUptime } from "../format";
import type { StaticInfo } from "../types";

export function SystemHeader({
  info,
  uptime,
  connected,
}: {
  info: StaticInfo | null;
  uptime: number | null;
  connected: boolean;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
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
      {uptime !== null && (
        <p className="text-xs text-zinc-500">
          up <span className="font-mono text-zinc-300">{formatUptime(uptime)}</span>
        </p>
      )}
    </header>
  );
}
