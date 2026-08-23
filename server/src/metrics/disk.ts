import { promises as fs } from "node:fs";
import path from "node:path";
import si from "systeminformation";
import { config } from "../config.js";
import type {
  DiskDeviceIo,
  DiskIoMetrics,
  DiskMetrics,
  FilesystemMetrics,
} from "../types.js";
import { readText } from "./sysfs.js";

/**
 * Usage comes from statfs(2) over the mounts listed in /proc/mounts, and
 * throughput from /proc/diskstats. systeminformation would shell out to `df`
 * and `lsblk` on every tick to answer the same questions — too much for a Pi
 * refreshing ten times a second. A host without procfs (macOS) falls back to
 * systeminformation for the primary mount.
 */
const PROC_MOUNTS = "/proc/mounts";
const PROC_DISKSTATS = "/proc/diskstats";

/**
 * Filesystems worth a row. An allow-list rather than a deny-list: a Linux
 * host mounts dozens of pseudo filesystems (cgroup, tracefs, one tmpfs per
 * user…) and none of them are storage anyone manages.
 */
const REAL_FILESYSTEMS = new Set([
  "btrfs",
  "cifs",
  "exfat",
  "ext2",
  "ext3",
  "ext4",
  "f2fs",
  "fuseblk",
  "iso9660",
  "nfs",
  "nfs4",
  "ntfs",
  "ntfs3",
  "vfat",
  "xfs",
  "zfs",
]);

/** virtual block devices, and partitions (covered by their parent device) */
const VIRTUAL_BLOCK = /^(loop|ram|zram|dm-|md)/;

/** enough to cover a Pi with a card, a boot partition and two USB disks */
const MAX_FILESYSTEMS = 8;
/** same idea for block devices: a card, an NVMe and a couple of USB disks */
const MAX_DEVICES = 8;

/** 512 bytes per sector, the unit /proc/diskstats has always counted in */
const SECTOR_BYTES = 512;

export interface MountEntry {
  device: string;
  mount: string;
  type: string;
  /**
   * Mounted read-only. Worth surfacing because a Pi rarely chooses it: the
   * kernel remounts a filesystem read-only when the card underneath starts
   * failing, and everything above keeps running as if nothing happened.
   */
  readOnly: boolean;
}

export function parseMounts(content: string): MountEntry[] {
  const entries: MountEntry[] = [];
  const seen = new Set<string>();

  for (const line of content.split("\n")) {
    const [device, mount, type, options] = line.split(" ");
    if (!device || !mount || !type || !REAL_FILESYSTEMS.has(type)) continue;
    // one device, one row: Docker bind-mounts /etc/hosts & friends off the
    // same filesystem, and they are not separate storage
    if (seen.has(device)) continue;
    seen.add(device);
    // mount points are escaped octal-style ("/mnt/my\040disk")
    entries.push({
      device,
      mount: mount.replace(/\\040/g, " "),
      type,
      readOnly: (options ?? "").split(",").includes("ro"),
    });
  }

  return entries;
}

/** raw counters for one whole disk, straight out of /proc/diskstats */
export interface DeviceCounters {
  readSectors: number;
  writeSectors: number;
  readOps: number;
  writeOps: number;
  /** milliseconds spent servicing reads / writes, summed over all requests */
  readMs: number;
  writeMs: number;
  /** milliseconds during which the queue was non-empty */
  ioMs: number;
}

export function parseDiskstats(content: string): Map<string, DeviceCounters> {
  const rows: { name: string; counters: DeviceCounters }[] = [];

  for (const line of content.split("\n")) {
    const fields = line.trim().split(/\s+/);
    // major minor name reads merged sectors ms writes merged sectors ms …
    if (fields.length < 14) continue;
    const name = fields[2]!;
    if (VIRTUAL_BLOCK.test(name)) continue;
    const numbers = fields.map(Number);
    const at = (index: number) => numbers[index]!;
    if ([3, 5, 6, 7, 9, 10, 12].some((index) => !Number.isFinite(at(index)))) continue;
    rows.push({
      name,
      counters: {
        readOps: at(3),
        readSectors: at(5),
        readMs: at(6),
        writeOps: at(7),
        writeSectors: at(9),
        writeMs: at(10),
        ioMs: at(12),
      },
    });
  }

  const devices = new Map<string, DeviceCounters>();
  for (const row of rows) {
    // a partition (mmcblk0p1, sda1, nvme0n1p1) repeats what its whole-disk
    // device already counted
    if (rows.some((other) => other !== row && row.name.startsWith(other.name))) {
      continue;
    }
    devices.set(row.name, row.counters);
  }
  return devices;
}

interface Usage {
  total: number;
  used: number;
  inodesTotal: number;
  inodesUsed: number;
}

async function usage(mount: string): Promise<Usage | null> {
  try {
    const stats = await fs.statfs(mount);
    const total = Number(stats.blocks) * Number(stats.bsize);
    const used = (Number(stats.blocks) - Number(stats.bfree)) * Number(stats.bsize);
    // inodes are a second, independent way to fill a card; vfat has none and
    // reports zero, which the UI reads as "nothing to show"
    const inodesTotal = Number(stats.files);
    return total > 0
      ? { total, used, inodesTotal, inodesUsed: inodesTotal - Number(stats.ffree) }
      : null;
  } catch {
    return null; // unmounted between the listing and the call
  }
}

/**
 * In Docker the host's root is mounted at /host, so every mount point reads
 * as "/host/boot/firmware". Names are shown as the host itself sees them.
 */
export function hostPrefix(diskPath: string, hostRoot: string): string | null {
  return diskPath !== "/" && diskPath.startsWith(hostRoot) ? hostRoot : null;
}

function displayMount(mount: string, prefix: string | null): string {
  if (prefix === null || !mount.startsWith(prefix)) return mount;
  return mount.slice(prefix.length) || "/";
}

export function createDiskReader(
  paths: {
    procMounts?: string;
    procDiskstats?: string;
    diskPath?: string;
    hostRoot?: string;
    /** the host's own mount table, seen through the read-only host mount */
    hostMounts?: string;
  } = {},
) {
  const mountsPath = paths.procMounts ?? PROC_MOUNTS;
  const diskstatsPath = paths.procDiskstats ?? PROC_DISKSTATS;
  const diskPath = paths.diskPath ?? config.diskPath;
  const hostRoot = paths.hostRoot ?? config.hostRoot;
  const prefix = hostPrefix(diskPath, hostRoot);
  const hostMountsPath = paths.hostMounts ?? path.join(hostRoot, "proc/mounts");
  let previous: { devices: Map<string, DeviceCounters>; at: number } | null = null;

  /**
   * Which mounts are read-only, as the host sees them.
   *
   * Inside the container this cannot come from our own /proc/mounts: the
   * compose file bind-mounts the host's root read-only on purpose, so every
   * host filesystem would be flagged. The host's own table, reachable
   * through that same mount, is the only honest source — and when it isn't
   * reachable the flag stays null rather than crying wolf.
   */
  async function readOnlyMounts(
    containerMounts: MountEntry[],
  ): Promise<Map<string, boolean> | null> {
    if (prefix === null) {
      return new Map(containerMounts.map((entry) => [entry.mount, entry.readOnly]));
    }
    const raw = await readText(hostMountsPath);
    if (raw === null) return null;
    return new Map(parseMounts(raw).map((entry) => [entry.mount, entry.readOnly]));
  }

  async function io(): Promise<DiskIoMetrics | null> {
    const raw = await readText(diskstatsPath);
    if (raw === null) return null;

    const now = Date.now();
    const devices = parseDiskstats(raw);
    const before = previous;
    previous = { devices, at: now };

    const seconds = before ? (now - before.at) / 1000 : 0;
    if (!before || seconds <= 0) {
      return { readSec: 0, writeSec: 0, iops: 0, awaitMs: null, utilPercent: 0, devices: [] };
    }

    const measured: DiskDeviceIo[] = [];
    for (const [name, counters] of devices) {
      const was = before.devices.get(name);
      // a disk plugged in since the last tick has nothing to compare against
      if (!was) continue;
      measured.push(deviceIo(name, was, counters, seconds));
    }
    measured.sort((a, b) => a.name.localeCompare(b.name));

    // the slowest disk is what the machine waits on: report its latency and
    // busy share rather than an average that hides it
    const busiest = measured.reduce<DiskDeviceIo | null>(
      (worst, entry) => (!worst || entry.utilPercent > worst.utilPercent ? entry : worst),
      null,
    );

    return {
      readSec: sum(measured, (entry) => entry.readSec),
      writeSec: sum(measured, (entry) => entry.writeSec),
      iops: sum(measured, (entry) => entry.iops),
      awaitMs: busiest?.awaitMs ?? null,
      utilPercent: busiest?.utilPercent ?? 0,
      devices: measured.slice(0, MAX_DEVICES),
    };
  }

  async function filesystems(): Promise<FilesystemMetrics[]> {
    const raw = await readText(mountsPath);
    if (raw === null) return [];

    const entries = parseMounts(raw);
    const readOnly = await readOnlyMounts(entries);

    const found: FilesystemMetrics[] = [];
    for (const entry of entries) {
      // inside the container only the host mount is the user's storage
      if (prefix !== null && !entry.mount.startsWith(prefix)) continue;
      const size = await usage(entry.mount);
      if (!size) continue;
      const mount = displayMount(entry.mount, prefix);
      found.push({
        mount,
        type: entry.type,
        total: size.total,
        used: size.used,
        inodesTotal: size.inodesTotal,
        inodesUsed: size.inodesUsed,
        readOnly: readOnly?.get(prefix === null ? entry.mount : mount) ?? null,
      });
    }

    return found
      .sort((a, b) => a.mount.localeCompare(b.mount))
      .slice(0, MAX_FILESYSTEMS);
  }

  return async function collectDisk(): Promise<DiskMetrics> {
    const [primary, list, throughput] = await Promise.all([
      usage(diskPath),
      filesystems(),
      io(),
    ]);

    const mount = displayMount(diskPath, prefix);
    const readOnly = list.find((entry) => entry.mount === mount)?.readOnly ?? null;
    if (primary) {
      return {
        mount,
        total: primary.total,
        used: primary.used,
        inodesTotal: primary.inodesTotal,
        inodesUsed: primary.inodesUsed,
        readOnly,
        filesystems: list,
        io: throughput,
      };
    }

    // statfs failed (or this isn't Linux): let systeminformation answer
    const fallback = await fallbackSize(diskPath);
    return {
      ...fallback,
      mount,
      inodesTotal: 0,
      inodesUsed: 0,
      readOnly,
      filesystems: list,
      io: throughput,
    };
  };
}

function deviceIo(
  name: string,
  before: DeviceCounters,
  now: DeviceCounters,
  seconds: number,
): DiskDeviceIo {
  const ops = delta(now.readOps + now.writeOps, before.readOps + before.writeOps);
  const busyMs = delta(now.ioMs, before.ioMs);
  const serviceMs = delta(
    now.readMs + now.writeMs,
    before.readMs + before.writeMs,
  );

  return {
    name,
    readSec: rate(now.readSectors, before.readSectors, seconds),
    writeSec: rate(now.writeSectors, before.writeSectors, seconds),
    iops: Math.round(ops / seconds),
    // mean time one request took: the number that turns "the disk is busy"
    // into "the disk is slow"
    awaitMs: ops > 0 ? Math.round((serviceMs / ops) * 10) / 10 : null,
    // a device can be busy more than 100% of the time on paper (parallel
    // requests on NVMe); as a share of the interval, cap it
    utilPercent: Math.min(Math.round((busyMs / (seconds * 1000)) * 1000) / 10, 100),
  };
}

/** counters only ever grow; a smaller value means a reboot or a wrap */
function delta(current: number, before: number): number {
  return Math.max(current - before, 0);
}

function rate(current: number, before: number, seconds: number): number {
  return Math.round((delta(current, before) * SECTOR_BYTES) / seconds);
}

function sum<T>(items: T[], of: (item: T) => number): number {
  return items.reduce((total, item) => total + of(item), 0);
}

async function fallbackSize(diskPath: string): Promise<{ total: number; used: number }> {
  const filesystems = await si.fsSize();
  let target = filesystems.find((entry) => entry.mount === diskPath);
  if (!target) {
    for (const entry of filesystems) {
      if (!target || entry.size > target.size) target = entry;
    }
  }
  return target ? { total: target.size, used: target.used } : { total: 0, used: 0 };
}

export const collectDisk = createDiskReader();
