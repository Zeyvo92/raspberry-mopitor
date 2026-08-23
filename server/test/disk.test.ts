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
      { device: "/dev/mmcblk0p2", mount: "/", type: "ext4", readOnly: false },
      {
        device: "/dev/mmcblk0p1",
        mount: "/boot/firmware",
        type: "vfat",
        readOnly: false,
      },
      { device: "/dev/sda1", mount: "/mnt/my disk", type: "ext4", readOnly: false },
    ]);
  });

  it("reads the read-only flag out of the mount options", () => {
    const content = `/dev/mmcblk0p2 / ext4 ro,relatime 0 0
/dev/sda1 /mnt/disk ext4 rw,noatime 0 0
/dev/sdb1 /mnt/other ext4 0 0
/dev/sdc1 /mnt/third ext4
`;
    expect(parseMounts(content).map((entry) => entry.readOnly)).toEqual([
      true,
      false,
      // "0" is not "ro", and neither is a line that stops early: a truncated
      // mount table must not raise the alarm
      false,
      false,
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
    const content = `   1       0 ram0 0 0 0 0 0 0 0 0 0 0 0 0 0
   7       0 loop0 12 0 900 4 0 0 0 0 0 0 0 0 0
 179       0 mmcblk0 1000 0 4000 500 800 0 2000 300 0 700 0
 179       1 mmcblk0p1 10 0 40 5 8 0 20 3 0 7 0
 259       0 nvme0n1 5 0 1000 2 3 0 500 1 0 4 0
 bad line
`;
    const devices = parseDiskstats(content);
    expect([...devices.keys()]).toEqual(["mmcblk0", "nvme0n1"]);
    expect(devices.get("mmcblk0")).toEqual({
      readOps: 1000,
      readSectors: 4000,
      readMs: 500,
      writeOps: 800,
      writeSectors: 2000,
      writeMs: 300,
      ioMs: 700,
    });
  });

  it("ignores rows whose counters aren't numbers", () => {
    const content = " 179 0 mmcblk0 x x x x x x x x x x x x x\n";
    expect(parseDiskstats(content).size).toBe(0);
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
    const idle = { readSec: 0, writeSec: 0, iops: 0, awaitMs: null, utilPercent: 0 };
    expect((await read()).io).toMatchObject({ ...idle, devices: [] });
    expect((await read()).io).toMatchObject(idle); // same ms

    vi.setSystemTime(1_700_000_002_000);
    // 200 more sectors each way, 3 more operations, 600 ms of service time
    // spread over 1 s of the 2 s interval
    await writeFile(diskstats, " 179 0 mmcblk0 3 0 300 400 2 0 600 200 0 1000 0\n");
    expect((await read()).io).toEqual({
      readSec: 51200, // 200 sectors × 512 B over 2 s
      writeSec: 102400,
      iops: 2, // 3 operations over 2 s, rounded
      awaitMs: 200, // 600 ms of service for 3 operations
      utilPercent: 50, // busy 1 s out of 2
      devices: [
        {
          name: "mmcblk0",
          readSec: 51200,
          writeSec: 102400,
          iops: 2,
          awaitMs: 200,
          utilPercent: 50,
        },
      ],
    });
  });

  it("reports the busiest device and ignores one plugged in mid-interval", async () => {
    const root = await diskFixture({}, () => "");
    const diskstats = path.join(root, "diskstats");
    // three disks, listed in the order the kernel happens to enumerate them
    await writeFile(
      diskstats,
      ` 259 0 nvme0n1 0 0 0 0 0 0 0 0 0 0 0
 179 0 mmcblk0 0 0 0 0 0 0 0 0 0 0 0
   8 0 sda 0 0 0 0 0 0 0 0 0 0 0
`,
    );

    const read = createDiskReader({
      procMounts: "/nonexistent",
      procDiskstats: diskstats,
      diskPath: root,
      hostRoot: "/host",
    });
    await read();

    vi.setSystemTime(1_700_000_001_000);
    await writeFile(
      diskstats,
      ` 259 0 nvme0n1 50 0 0 50 0 0 0 0 0 900 0
 179 0 mmcblk0 10 0 0 100 0 0 0 0 0 100 0
   8 0 sda 0 0 0 0 0 0 0 0 0 0 0
   8 16 sdb 5 0 0 5 0 0 0 0 0 500 0
`,
    );
    const io = (await read()).io;
    // sorted by name, and sdb has no previous sample to subtract from
    expect(io?.devices.map((device) => device.name)).toEqual([
      "mmcblk0",
      "nvme0n1",
      "sda",
    ]);
    expect(io?.iops).toBe(60);
    // a disk that served nothing has no latency to report
    expect(io?.devices.at(-1)).toMatchObject({ name: "sda", iops: 0, awaitMs: null });
    // the NVMe was busy 900 ms of the second and served 50 requests in 50 ms
    expect(io?.utilPercent).toBe(90);
    expect(io?.awaitMs).toBe(1);

    // a device can queue requests in parallel and report more busy time than
    // the interval lasted: as a share of it, that is 100%
    vi.setSystemTime(1_700_000_002_000);
    await writeFile(diskstats, " 179 0 mmcblk0 20 0 0 100 0 0 0 0 0 3000 0\n");
    expect((await read()).io?.utilPercent).toBe(100);
  });

  it("reports no throughput when every device it knew has gone", async () => {
    const root = await diskFixture({}, () => "");
    const diskstats = path.join(root, "diskstats");
    await writeFile(diskstats, " 179 0 mmcblk0 1 0 1 1 1 0 1 1 0 1 0\n");

    const read = createDiskReader({
      procMounts: "/nonexistent",
      procDiskstats: diskstats,
      diskPath: root,
      hostRoot: "/host",
    });
    await read();

    // the card was pulled and a USB disk enumerated in its place
    vi.setSystemTime(1_700_000_001_000);
    await writeFile(diskstats, " 8 0 sda 5 0 5 5 5 0 5 5 0 5 0\n");
    expect((await read()).io).toEqual({
      readSec: 0,
      writeSec: 0,
      iops: 0,
      awaitMs: null,
      utilPercent: 0,
      devices: [],
    });
  });

  it("reads inodes and the read-only flag from the host's own mount table", async () => {
    const root = await diskFixture(
      { host: { boot: {} } },
      (dir) => `/dev/mmcblk0p2 ${dir}/host ext4 ro 0 0
/dev/mmcblk0p1 ${dir}/host/boot vfat ro 0 0
`,
    );
    // what the Pi itself sees: only the boot partition is really read-only,
    // the root only looks that way because the container mounted it :ro
    const hostMounts = path.join(root, "host-mounts");
    await writeFile(
      hostMounts,
      `/dev/mmcblk0p2 / ext4 rw,relatime 0 0
/dev/mmcblk0p1 /boot vfat ro 0 0
`,
    );

    const disk = await createDiskReader({
      procMounts: path.join(root, "proc", "mounts"),
      procDiskstats: "/nonexistent",
      diskPath: path.join(root, "host"),
      hostRoot: path.join(root, "host"),
      hostMounts,
    })();

    expect(disk.readOnly).toBe(false);
    expect(disk.filesystems.map((entry) => [entry.mount, entry.readOnly])).toEqual([
      ["/", false],
      ["/boot", true],
    ]);
    expect(disk.inodesTotal).toBeGreaterThan(0);
    expect(disk.inodesUsed).toBeGreaterThan(0);
  });

  it("leaves the read-only flag unknown when the host's table is out of reach", async () => {
    const root = await diskFixture(
      { host: {} },
      (dir) => `/dev/mmcblk0p2 ${dir}/host ext4 ro 0 0\n`,
    );

    const disk = await createDiskReader({
      procMounts: path.join(root, "proc", "mounts"),
      procDiskstats: "/nonexistent",
      diskPath: path.join(root, "host"),
      hostRoot: path.join(root, "host"),
      hostMounts: "/nonexistent",
    })();

    expect(disk.readOnly).toBeNull();
    expect(disk.filesystems[0]?.readOnly).toBeNull();
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
