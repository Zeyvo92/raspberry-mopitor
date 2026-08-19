import path from "node:path";
import { writeFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const si = vi.hoisted(() => ({ fsSize: vi.fn() }));
vi.mock("systeminformation", () => ({ default: si }));

import {
  createDiskReader,
  hostPrefix,
  parseDiskstats,
  parseMounts,
} from "../src/metrics/disk.js";
import { cleanupFixtures, fixtureDir, type FileTree } from "./fixtures.js";

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(1_700_000_000_000);
});

afterEach(async () => {
  vi.useRealTimers();
  await cleanupFixtures();
});

describe("parseMounts", () => {
  it("keeps real storage and drops everything the kernel invents", () => {
    const content = `proc /proc proc rw 0 0
/dev/mmcblk0p2 / ext4 rw,relatime 0 0
tmpfs /run tmpfs rw 0 0
/dev/mmcblk0p1 /boot/firmware vfat rw 0 0
cgroup2 /sys/fs/cgroup cgroup2 rw 0 0
/dev/sda1 /mnt/my\\040disk ext4 rw 0 0
`;
    expect(parseMounts(content)).toEqual([
      { device: "/dev/mmcblk0p2", mount: "/", type: "ext4" },
      { device: "/dev/mmcblk0p1", mount: "/boot/firmware", type: "vfat" },
      { device: "/dev/sda1", mount: "/mnt/my disk", type: "ext4" },
    ]);
  });

  it("lists a device once, however many times Docker bind-mounts it", () => {
    const content = `/dev/mmcblk0p2 /host ext4 rw 0 0
/dev/mmcblk0p2 /etc/hosts ext4 rw 0 0
/dev/mmcblk0p2 /etc/resolv.conf ext4 rw 0 0
`;
    expect(parseMounts(content)).toHaveLength(1);
  });
});

describe("parseDiskstats", () => {
  it("counts whole disks once and ignores partitions and virtual devices", () => {
    const content = `   1       0 ram0 0 0 0 0 0 0 0 0 0 0 0
   7       0 loop0 12 0 900 4 0 0 0 0 0 0 0
 179       0 mmcblk0 1000 0 4000 500 800 0 2000 300 0 0 0
 179       1 mmcblk0p1 10 0 40 5 8 0 20 3 0 0 0
 259       0 nvme0n1 5 0 1000 2 3 0 500 1 0 0 0
 bad line
`;
    expect(parseDiskstats(content)).toEqual({
      readSectors: 5000, // 4000 + 1000
      writeSectors: 2500, // 2000 + 500
    });
  });

  it("ignores rows whose counters aren't numbers", () => {
    const content = " 179 0 mmcblk0 x x x x x x x x x x x\n";
    expect(parseDiskstats(content)).toEqual({ readSectors: 0, writeSectors: 0 });
  });
});

describe("hostPrefix", () => {
  it("only strips a prefix when the host really is mounted elsewhere", () => {
    expect(hostPrefix("/host", "/host")).toBe("/host");
    expect(hostPrefix("/", "/host")).toBeNull();
    expect(hostPrefix("/mnt/data", "/host")).toBeNull();
  });
});

async function diskFixture(tree: FileTree, mounts: (root: string) => string) {
  const root = await fixtureDir({ ...tree, proc: {} });
  await writeFile(path.join(root, "proc", "mounts"), mounts(root));
  return root;
}

describe("createDiskReader", () => {
  it("reports the configured mount and every real filesystem", async () => {
    const root = await diskFixture(
      { boot: {}, data: {} },
      (dir) => `/dev/mmcblk0p2 ${dir}/data ext4 rw 0 0
/dev/mmcblk0p1 ${dir}/boot vfat rw 0 0
proc /proc proc rw 0 0
`,
    );

    const disk = await createDiskReader({
      procMounts: path.join(root, "proc", "mounts"),
      procDiskstats: "/nonexistent",
      diskPath: path.join(root, "data"),
      hostRoot: "/host",
    })();

    expect(disk.mount).toBe(path.join(root, "data"));
    expect(disk.total).toBeGreaterThan(0);
    expect(disk.io).toBeNull();
    expect(disk.filesystems.map((entry) => entry.type)).toEqual(["vfat", "ext4"]);
  });

  it("shows Docker mounts under the names the host uses", async () => {
    const root = await diskFixture(
      { boot: {} },
      (dir) => `/dev/mmcblk0p2 ${dir} ext4 rw 0 0
/dev/mmcblk0p1 ${dir}/boot vfat rw 0 0
/dev/sdb1 /data ext4 rw 0 0
`,
    );

    const disk = await createDiskReader({
      procMounts: path.join(root, "proc", "mounts"),
      procDiskstats: "/nonexistent",
      diskPath: root,
      hostRoot: root,
    })();

    expect(disk.mount).toBe("/");
    // /data belongs to the container, not to the Pi being monitored
    expect(disk.filesystems.map((entry) => entry.mount)).toEqual(["/", "/boot"]);
  });

  it("skips a mount with no blocks and caps the list", async () => {
    const dirs: FileTree = {};
    for (let index = 0; index < 9; index++) dirs[`d${index}`] = {};
    const root = await diskFixture(dirs, (dir) => {
      let content = "procfs /proc ext4 rw 0 0\n"; // statfs reports zero blocks
      for (let index = 0; index < 9; index++) {
        content += `/dev/sd${index} ${dir}/d${index} ext4 rw 0 0\n`;
      }
      return content;
    });

    const disk = await createDiskReader({
      procMounts: path.join(root, "proc", "mounts"),
      procDiskstats: "/nonexistent",
      diskPath: root,
      hostRoot: "/host",
    })();

    expect(disk.filesystems).toHaveLength(8);
  });

  it("turns disk sectors into bytes per second", async () => {
    const root = await diskFixture({}, () => "");
    const diskstats = path.join(root, "diskstats");
    await writeFile(diskstats, " 179 0 mmcblk0 1 0 100 0 1 0 200 0 0 0 0\n");

    const read = createDiskReader({
      procMounts: "/nonexistent",
      procDiskstats: diskstats,
      diskPath: root,
      hostRoot: "/host",
    });
    expect((await read()).io).toEqual({ readSec: 0, writeSec: 0 });
    expect((await read()).io).toEqual({ readSec: 0, writeSec: 0 }); // same ms

    vi.setSystemTime(1_700_000_002_000);
    await writeFile(diskstats, " 179 0 mmcblk0 1 0 300 0 1 0 600 0 0 0 0\n");
    expect((await read()).io).toEqual({
      readSec: 51200, // 200 sectors × 512 B over 2 s
      writeSec: 102400,
    });
  });

  it("asks systeminformation when statfs cannot answer", async () => {
    const read = createDiskReader({
      procMounts: "/nonexistent",
      procDiskstats: "/nonexistent",
      diskPath: "/nonexistent",
      hostRoot: "/host",
    });

    si.fsSize.mockResolvedValue([
      { mount: "/small", size: 10, used: 1 },
      { mount: "/nonexistent", size: 1000, used: 300 },
    ]);
    expect(await read()).toMatchObject({ total: 1000, used: 300 });

    si.fsSize.mockResolvedValue([
      { mount: "/small", size: 10, used: 1 },
      { mount: "/big", size: 5000, used: 100 },
    ]);
    expect(await read()).toMatchObject({ total: 5000, used: 100 });

    si.fsSize.mockResolvedValue([
      { mount: "/big", size: 5000, used: 100 },
      { mount: "/small", size: 10, used: 1 },
    ]);
    expect(await read()).toMatchObject({ total: 5000, used: 100 });

    si.fsSize.mockResolvedValue([]);
    expect(await read()).toMatchObject({ total: 0, used: 0 });
  });
});
