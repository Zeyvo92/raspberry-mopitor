import si from "systeminformation";
import { config } from "../config.js";
import type { ProcessInfo, ProcessList } from "../types.js";

const COMMAND_MAX_LENGTH = 120;

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * The union of the top N by CPU and the top N by memory, so the client can
 * re-sort on either key without asking the server again.
 *
 * Processes using neither are dropped first: a Pi runs dozens of idle kernel
 * threads with 0% CPU and no resident memory, and they would otherwise win
 * the ties and fill the table with rows saying nothing.
 */
export function selectTop(
  processes: readonly ProcessInfo[],
  topN: number,
): ProcessInfo[] {
  const active = processes.filter((p) => p.cpu > 0 || p.memBytes > 0);
  const byCpu = [...active].sort((a, b) => b.cpu - a.cpu).slice(0, topN);
  const byMem = [...active].sort((a, b) => b.memBytes - a.memBytes).slice(0, topN);

  const merged = new Map<number, ProcessInfo>();
  for (const p of [...byCpu, ...byMem]) merged.set(p.pid, p);
  return [...merged.values()].sort((a, b) => b.cpu - a.cpu);
}

/**
 * Scanning every process is the priciest collector we have (~100-300 ms on a
 * Pi), which is why the hub only runs it while a client is watching the
 * process tab, and at its own slower interval.
 */
export async function collectProcesses(
  topN: number = config.processesTopN,
): Promise<ProcessList> {
  const data = await si.processes();

  const list = data.list.map<ProcessInfo>((p) => ({
    pid: p.pid,
    name: p.name,
    cpu: round1(p.cpu),
    memPercent: round1(p.mem),
    // memRss is reported in KB on Linux (ps rss), which is all we target
    memBytes: Math.max(Math.round(p.memRss * 1024), 0),
    user: p.user,
    command: formatCommand(p.command, p.params),
  }));

  return {
    ts: Date.now(),
    total: data.all,
    running: data.running,
    sleeping: data.sleeping,
    list: selectTop(list, topN),
  };
}

function formatCommand(command: string, params: string): string {
  const full = `${command ?? ""} ${params ?? ""}`.trim();
  return full.length > COMMAND_MAX_LENGTH
    ? `${full.slice(0, COMMAND_MAX_LENGTH - 1)}…`
    : full;
}
