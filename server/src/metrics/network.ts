import path from "node:path";
import si from "systeminformation";
import { config } from "../config.js";
import type {
  InterfaceMetrics,
  NetworkMetrics,
  TcpMetrics,
  WifiMetrics,
} from "../types.js";
import { readNumber, readText, throttled } from "./sysfs.js";

/**
 * Counters live in /proc/net/dev: one read gives every interface at once.
 * systeminformation would do the same job by spawning a shell per interface
 * on each tick — at a 100 ms refresh that is the most expensive thing the
 * monitor could do to a Pi, so the parsing lives here instead. Hosts without
 * procfs (a contributor on macOS) fall back to systeminformation, which still
 * reports the default interface.
 */
const PROC_NET_DEV = "/proc/net/dev";
const PROC_NET_ROUTE = "/proc/net/route";
const PROC_NET_SNMP = "/proc/net/snmp";
const SYS_CLASS_NET = "/sys/class/net";

/** loopback says nothing, and one veth per container would drown the list */
const IGNORED = /^(lo|veth)/;

/** a negotiated link changes when someone moves a cable, not every second */
const LINK_TTL_MS = 30_000;
/** host-wide TCP counters: context, not a live gauge */
const TCP_CACHE_MS = 1000;

interface Counters {
  rxBytes: number;
  txBytes: number;
  rxPackets: number;
  txPackets: number;
  /** epoch ms of the reading, so a skipped tick doesn't inflate the rate */
  at: number;
}

export interface Reading {
  iface: string;
  rxBytes: number;
  txBytes: number;
  rxPackets: number;
  txPackets: number;
  /** errors and drops, both directions summed: a reader wants "is it clean?" */
  errors: number;
  drops: number;
}

export function parseProcNetDev(content: string): Reading[] {
  const readings: Reading[] = [];
  // two header lines, then "  iface: rx_bytes packets errs drop fifo frame
  // compressed multicast tx_bytes packets errs drop …"
  for (const line of content.split("\n").slice(2)) {
    const [name, rest] = line.split(":");
    if (rest === undefined) continue;
    const iface = name!.trim();
    if (!iface || IGNORED.test(iface)) continue;
    const fields = rest.trim().split(/\s+/).map(Number);
    const rxBytes = fields[0];
    const txBytes = fields[8];
    if (!Number.isFinite(rxBytes) || !Number.isFinite(txBytes)) continue;
    // an interface that has never carried a byte is down, or a shaping
    // device the kernel created (ifb0, dummy0) — neither is worth a row
    if (rxBytes! + txBytes! === 0) continue;
    const field = (index: number) => {
      const value = fields[index];
      return Number.isFinite(value) ? value! : 0;
    };
    readings.push({
      iface,
      rxBytes: rxBytes!,
      txBytes: txBytes!,
      rxPackets: field(1),
      txPackets: field(9),
      errors: field(2) + field(10),
      drops: field(3) + field(11),
    });
  }
  return readings;
}

/** the interface carrying the default route — destination 0.0.0.0 */
export function parseDefaultIface(content: string): string | null {
  for (const line of content.split("\n").slice(1)) {
    const fields = line.trim().split(/\s+/);
    if (fields.length > 1 && fields[1] === "00000000") return fields[0]!;
  }
  return null;
}

/**
 * /proc/net/wireless holds the numbers `iwconfig` prints. Quality is a
 * fraction of a driver-defined maximum — 70 on every mac80211 driver, which
 * is what a Pi uses — and the level is dBm, unsigned on older drivers.
 */
const WIFI_QUALITY_MAX = 70;

export function parseWireless(content: string): WifiMetrics | null {
  for (const line of content.split("\n").slice(2)) {
    const [name, rest] = line.split(":");
    if (rest === undefined) continue;
    const iface = name!.trim();
    if (!iface) continue;
    const fields = rest.trim().split(/\s+/);
    const link = Number.parseFloat(fields[1] ?? "");
    const level = Number.parseFloat(fields[2] ?? "");
    return {
      iface,
      quality: Number.isFinite(link)
        ? Math.min(Math.round((link / WIFI_QUALITY_MAX) * 100), 100)
        : null,
      // some drivers report the level as an unsigned byte
      signalDbm: Number.isFinite(level) ? (level > 0 ? level - 256 : level) : null,
    };
  }
  return null;
}

/**
 * /proc/net/snmp pairs a header line of column names with a line of values,
 * per protocol. Only the TCP row interests us: how many connections are up,
 * and how many segments the kernel had to send twice.
 */
export function parseSnmpTcp(
  content: string,
): { established: number; retransSegs: number } | null {
  const lines = content.split("\n");
  for (const [index, line] of lines.entries()) {
    if (!line.startsWith("Tcp: ")) continue;
    const names = line.slice(5).trim().split(/\s+/);
    // the header is the row whose fields aren't numbers; its values follow
    if (Number.isFinite(Number(names[0]))) continue;
    const values = (lines[index + 1] ?? "").slice(5).trim().split(/\s+/).map(Number);
    const read = (name: string) => {
      const value = values[names.indexOf(name)];
      return Number.isFinite(value) ? value! : null;
    };
    const established = read("CurrEstab");
    const retransSegs = read("RetransSegs");
    if (established === null || retransSegs === null) continue;
    return { established, retransSegs };
  }
  return null;
}

export function createNetworkReader(
  paths: {
    procNetDev?: string;
    procNetRoute?: string;
    procNetSnmp?: string;
    sysClassNet?: string;
    wirelessPath?: string;
  } = {},
) {
  const netDev = paths.procNetDev ?? PROC_NET_DEV;
  const netRoute = paths.procNetRoute ?? PROC_NET_ROUTE;
  const netSnmp = paths.procNetSnmp ?? PROC_NET_SNMP;
  const classNet = paths.sysClassNet ?? SYS_CLASS_NET;
  const wireless = paths.wirelessPath ?? config.wirelessPath;
  const previous = new Map<string, Counters>();
  const links = new Map<
    string,
    { speedMbps: number | null; duplex: string | null; at: number }
  >();

  /** what ethtool would report; absent on Wi-Fi and virtual interfaces */
  async function link(iface: string) {
    const cached = links.get(iface);
    if (cached && Date.now() - cached.at < LINK_TTL_MS) return cached;

    const dir = path.join(classNet, iface);
    const [speed, duplex] = await Promise.all([
      readNumber(path.join(dir, "speed")),
      readText(path.join(dir, "duplex")),
    ]);
    // a down interface reports -1, and "unknown" is the driver shrugging
    const info = {
      speedMbps: speed !== null && speed > 0 ? speed : null,
      duplex: duplex === "unknown" ? null : duplex,
      at: Date.now(),
    };
    links.set(iface, info);
    return info;
  }

  const tcp = throttled(TCP_CACHE_MS, async (): Promise<TcpMetrics | null> => {
    const raw = await readText(netSnmp);
    if (raw === null) return null;
    const counters = parseSnmpTcp(raw);
    if (counters === null) return null;

    const now = Date.now();
    const before = lastTcp;
    lastTcp = { retransSegs: counters.retransSegs, at: now };
    const seconds = before ? (now - before.at) / 1000 : 0;

    return {
      established: counters.established,
      retransSegsSec:
        before && seconds > 0
          ? Math.round(
              Math.max((counters.retransSegs - before.retransSegs) / seconds, 0) * 100,
            ) / 100
          : null,
    };
  });
  let lastTcp: { retransSegs: number; at: number } | null = null;

  return async function collectNetwork(): Promise<NetworkMetrics> {
    const raw = await readText(netDev);
    if (raw === null) return fallback();

    const now = Date.now();
    const interfaces: InterfaceMetrics[] = [];
    for (const reading of parseProcNetDev(raw)) {
      const before = previous.get(reading.iface);
      previous.set(reading.iface, {
        rxBytes: reading.rxBytes,
        txBytes: reading.txBytes,
        rxPackets: reading.rxPackets,
        txPackets: reading.txPackets,
        at: now,
      });
      // no previous sample, or two readings inside the same millisecond:
      // report 0 rather than dividing by zero
      const seconds = before ? (now - before.at) / 1000 : 0;
      const per = (current: number, key: keyof Counters) =>
        seconds > 0 ? rate(current, before![key], seconds) : 0;
      const { speedMbps, duplex } = await link(reading.iface);
      interfaces.push({
        iface: reading.iface,
        rxSec: per(reading.rxBytes, "rxBytes"),
        txSec: per(reading.txBytes, "txBytes"),
        rxBytes: reading.rxBytes,
        txBytes: reading.txBytes,
        rxPacketsSec: per(reading.rxPackets, "rxPackets"),
        txPacketsSec: per(reading.txPackets, "txPackets"),
        errors: reading.errors,
        drops: reading.drops,
        speedMbps,
        duplex,
      });
    }

    const [routes, wifiRaw, tcpMetrics] = await Promise.all([
      readText(netRoute),
      readText(wireless),
      tcp(),
    ]);
    const primary = pickPrimary(interfaces, routes);

    return {
      iface: primary?.iface ?? "unknown",
      rxSec: primary?.rxSec ?? 0,
      txSec: primary?.txSec ?? 0,
      interfaces,
      wifi: wifiRaw === null ? null : parseWireless(wifiRaw),
      tcp: tcpMetrics,
    };
  };
}

/** a counter that went backwards means it wrapped, or the link was reset */
function rate(current: number, before: number, seconds: number): number {
  return Math.max(Math.round((current - before) / seconds), 0);
}

function pickPrimary(
  interfaces: InterfaceMetrics[],
  routes: string | null,
): InterfaceMetrics | undefined {
  const defaultIface = routes === null ? null : parseDefaultIface(routes);
  const byRoute = interfaces.find((entry) => entry.iface === defaultIface);
  if (byRoute) return byRoute;
  // no default route (Pi on an isolated network): headline the busiest link
  return interfaces.reduce<InterfaceMetrics | undefined>(
    (best, entry) => (!best || entry.rxBytes > best.rxBytes ? entry : best),
    undefined,
  );
}

/** procfs-less host (macOS dev machine): the default interface, no more */
async function fallback(): Promise<NetworkMetrics> {
  const [stats] = await si.networkStats();
  if (!stats) {
    return {
      iface: "unknown",
      rxSec: 0,
      txSec: 0,
      interfaces: [],
      wifi: null,
      tcp: null,
    };
  }
  const entry: InterfaceMetrics = {
    iface: stats.iface,
    rxSec: Math.max(Math.round(stats.rx_sec ?? 0), 0),
    txSec: Math.max(Math.round(stats.tx_sec ?? 0), 0),
    rxBytes: stats.rx_bytes ?? 0,
    txBytes: stats.tx_bytes ?? 0,
    rxPacketsSec: 0,
    txPacketsSec: 0,
    errors: (stats.rx_errors ?? 0) + (stats.tx_errors ?? 0),
    drops: (stats.rx_dropped ?? 0) + (stats.tx_dropped ?? 0),
    speedMbps: null,
    duplex: null,
  };
  return {
    iface: entry.iface,
    rxSec: entry.rxSec,
    txSec: entry.txSec,
    interfaces: [entry],
    wifi: null,
    tcp: null,
  };
}

export const collectNetwork = createNetworkReader();
