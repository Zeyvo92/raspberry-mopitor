import { promises as fs } from "node:fs";
import si from "systeminformation";
import { config } from "../config.js";
import type { ContainerInfo, ContainerList } from "../types.js";

/**
 * Container stats need the Docker socket, which the compose file does *not*
 * mount by default (it is a root-equivalent grant). No socket, no tab: the
 * probe simply reports the feature as unavailable.
 */
export async function isDockerAvailable(
  socketPath: string = config.dockerSocket,
): Promise<boolean> {
  if (!config.dockerStats) return false;
  try {
    await fs.access(socketPath);
    return true;
  } catch {
    return false;
  }
}

interface NetSample {
  ts: number;
  rx: number;
  tx: number;
}

/**
 * Docker reports network counters as totals since container start; the UI
 * wants a rate, like the host network card, so we keep the previous sample
 * per container and derive bytes/s from the delta.
 */
export function createContainerReader() {
  const previous = new Map<string, NetSample>();
  let warned = false;

  return async function collectContainers(): Promise<ContainerList> {
    const ts = Date.now();
    let containers: si.Systeminformation.DockerContainerData[];
    let stats: si.Systeminformation.DockerContainerStatsData[];
    try {
      [containers, stats] = await Promise.all([
        si.dockerContainers(true),
        si.dockerContainerStats("*"),
      ]);
    } catch (err) {
      // permission denied on the socket is the usual cause — say it once
      if (!warned) {
        console.warn("docker: cannot read container stats —", String(err));
        warned = true;
      }
      return { ts, list: [] };
    }
    warned = false;

    const statsById = new Map(stats.map((s) => [s.id.slice(0, 12), s]));
    const seen = new Set<string>();

    const list = containers.map<ContainerInfo>((container) => {
      const id = container.id.slice(0, 12);
      seen.add(id);
      const stat = statsById.get(id);
      const net = stat ? netRates(previous, id, ts, stat.netIO) : null;

      return {
        id,
        name: container.name,
        image: container.image,
        state: container.state,
        cpuPercent: stat ? round(stat.cpuPercent) : null,
        memUsage: stat ? Math.round(stat.memUsage) : null,
        memLimit: stat ? Math.round(stat.memLimit) : null,
        netRxSec: net?.rxSec ?? null,
        netTxSec: net?.txSec ?? null,
        startedAt: container.started > 0 ? container.started * 1000 : 0,
      };
    });

    // forget containers that are gone so the map can't grow forever
    for (const id of previous.keys()) {
      if (!seen.has(id)) previous.delete(id);
    }

    list.sort(
      (a, b) => Number(b.state === "running") - Number(a.state === "running") ||
        (b.cpuPercent ?? -1) - (a.cpuPercent ?? -1) ||
        a.name.localeCompare(b.name),
    );

    return { ts, list };
  };
}

function netRates(
  previous: Map<string, NetSample>,
  id: string,
  ts: number,
  netIO: { rx: number; wx: number },
): { rxSec: number; txSec: number } | null {
  const current: NetSample = { ts, rx: netIO.rx, tx: netIO.wx };
  const last = previous.get(id);
  previous.set(id, current);
  if (!last || ts <= last.ts) return null;

  const seconds = (ts - last.ts) / 1000;
  // counters reset when a container restarts: report 0 rather than a negative
  return {
    rxSec: Math.max(Math.round((current.rx - last.rx) / seconds), 0),
    txSec: Math.max(Math.round((current.tx - last.tx) / seconds), 0),
  };
}

function round(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 10) / 10 : 0;
}

export const collectContainers = createContainerReader();
