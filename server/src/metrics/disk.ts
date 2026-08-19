import { promises as fs } from "node:fs";
import si from "systeminformation";
import { config } from "../config.js";
import type { DiskIoMetrics, DiskMetrics, FilesystemMetrics } from "../types.js";
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

/** 512 bytes per sector, the unit /proc/diskstats has always counted in */
const SECTOR_BYTES = 512;

export interface MountEntry {
  device: string;
  mount: string;
  type: string;
}

export function parseMounts(content: string): MountEntry[] {
  const entries: MountEntry[] = [];
  const seen = new Set<string>();

  for (const line of content.split("\n")) {
    const [device, mount, type] = line.split(" ");
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
    });
  }

  return entries;
}

export function parseDiskstats(content: string): {
  readSectors: number;
  writeSectors: number;
} {
  const rows: { name: string; read: number; written: number }[] = [];

  for (const line of content.split("\n")) {
    const fields = line.trim().split(/\s+/);
    // major minor name reads merged sectors ms writes merged sectors …
    if (fields.length < 10) continue;
    const name = fields[2]!;
    if (VIRTUAL_BLOCK.test(name)) continue;
    const read = Number(fields[5]);
    const written = Number(fields[9]);
    if (!Number.isFinite(read) || !Number.isFinite(written)) continue;
    rows.push({ name, read, written });
  }

  let readSectors = 0;
  let writeSectors = 0;
  for (const row of rows) {
    // a partition (mmcblk0p1, sda1, nvme0n1p1) repeats what its whole-disk
    // device already counted
    if (rows.some((other) => other !== row && row.name.startsWith(other.name))) {
      continue;
    }
    readSectors += row.read;
    writeSectors += row.written;
  }

  return { readSectors, writeSectors };
}

async function usage(mount: string): Promise<{ total: number; used: number } | null> {
  try {
    const stats = await fs.statfs(mount);
    const total = Number(stats.blocks) * Number(stats.bsize);
    const used = (Number(stats.blocks) - Number(stats.bfree)) * Number(stats.bsize);
    return total > 0 ? { total, used } : null;
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
  } = {},
) {
  const mountsPath = paths.procMounts ?? PROC_MOUNTS;
  const diskstatsPath = paths.procDiskstats ?? PROC_DISKSTATS;
  const diskPath = paths.diskPath ?? config.diskPath;
  const prefix = hostPrefix(diskPath, paths.hostRoot ?? config.hostRoot);
  let previous: { readSectors: number; writeSectors: number; at: number } | null =
    null;

  async function io(): Promise<DiskIoMetrics | null> {
    const raw = await readText(diskstatsPath);
    if (raw === null) return null;

    const now = Date.now();
    const totals = parseDiskstats(raw);
    const before = previous;
    previous = { ...totals, at: now };
    if (!before) return { readSec: 0, writeSec: 0 };

    const seconds = (now - before.at) / 1000;
    if (seconds <= 0) return { readSec: 0, writeSec: 0 };
    return {
      readSec: rate(totals.readSectors, before.readSectors, seconds),
      writeSec: rate(totals.writeSectors, before.writeSectors, seconds),
    };
  }

  async function filesystems(): Promise<FilesystemMetrics[]> {
    const raw = await readText(mountsPath);
    if (raw === null) return [];

    const found: FilesystemMetrics[] = [];
    for (const entry of parseMounts(raw)) {
      // inside the container only the host mount is the user's storage
      if (prefix !== null && !entry.mount.startsWith(prefix)) continue;
      const size = await usage(entry.mount);
      if (!size) continue;
      found.push({
        mount: displayMount(entry.mount, prefix),
        type: entry.type,
        total: size.total,
        used: size.used,
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
    if (primary) {
      return {
        mount,
        total: primary.total,
        used: primary.used,
        filesystems: list,
        io: throughput,
      };
    }

    // statfs failed (or this isn't Linux): let systeminformation answer
    const fallback = await fallbackSize(diskPath);
    return { ...fallback, mount, filesystems: list, io: throughput };
  };
}

function rate(current: number, before: number, seconds: number): number {
  return Math.max(Math.round(((current - before) * SECTOR_BYTES) / seconds), 0);
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
