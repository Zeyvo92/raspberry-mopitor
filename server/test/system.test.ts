import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const si = vi.hoisted(() => ({
  system: vi.fn(),
  osInfo: vi.fn(),
  cpu: vi.fn(),
}));
vi.mock("systeminformation", () => ({ default: si }));

import {
  collectStaticInfo,
  parseLifeTime,
  readCpuFreqPolicy,
  readHardwareModel,
  readHostOsRelease,
  readStorageHealth,
} from "../src/metrics/system.js";
import { cleanupFixtures, fixtureDir } from "./fixtures.js";

let fixtureRoot: string;

beforeEach(() => {
  vi.clearAllMocks();
  si.system.mockResolvedValue({ manufacturer: "", model: "Docker Container" });
  si.osInfo.mockResolvedValue({
    distro: "Alpine Linux",
    release: "3.21",
    kernel: "6.6.0",
    arch: "arm64",
  });
  si.cpu.mockResolvedValue({ manufacturer: "ARM", brand: "Cortex-A76", cores: 4 });
});

afterAll(async () => {
  await rm(fixtureRoot, { recursive: true, force: true });
  await cleanupFixtures();
});

async function piFixtures() {
  fixtureRoot ??= await mkdtemp(path.join(os.tmpdir(), "system-"));
  const devicetreePath = path.join(fixtureRoot, "model");
  // the kernel exposes a NUL-terminated string
  await writeFile(devicetreePath, Buffer.from("Raspberry Pi 5 Model B Rev 1.0\0"));
  const hostRoot = path.join(fixtureRoot, "host");
  await mkdir(path.join(hostRoot, "etc"), { recursive: true });
  await writeFile(
    path.join(hostRoot, "etc", "os-release"),
    'PRETTY_NAME="Raspberry Pi OS Lite (bookworm)"\nNAME="Raspberry Pi OS"\nID=raspbian\n',
  );
  // sysfs bits are pointed at fixtures too: a test box must never make the
  // expectations depend on its own hardware
  const cpufreqRoot = await fixtureDir({
    cpu0: {
      cpufreq: { scaling_governor: "ondemand\n", cpuinfo_max_freq: "2400000\n" },
    },
  });
  const blockRoot = await fixtureDir({
    mmcblk0: { device: { name: "SC32G\n", life_time: "0x02 0x01\n" } },
  });
  return { devicetreePath, hostRoot, cpufreqRoot, blockRoot };
}

describe("readHardwareModel", () => {
  it("reads the device tree model and strips NUL bytes", async () => {
    const { devicetreePath } = await piFixtures();
    expect(await readHardwareModel(devicetreePath)).toBe(
      "Raspberry Pi 5 Model B Rev 1.0",
    );
  });

  it("returns null when the file is missing or empty", async () => {
    expect(await readHardwareModel("/nonexistent")).toBeNull();
    const empty = path.join(await mkdtemp(path.join(os.tmpdir(), "dt-")), "model");
    await writeFile(empty, "\0");
    expect(await readHardwareModel(empty)).toBeNull();
    await rm(path.dirname(empty), { recursive: true, force: true });
  });
});

describe("readHostOsRelease", () => {
  it("parses PRETTY_NAME from the host os-release", async () => {
    const { hostRoot } = await piFixtures();
    expect(await readHostOsRelease(hostRoot)).toBe("Raspberry Pi OS Lite (bookworm)");
  });

  it("handles unquoted values", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osr-"));
    await mkdir(path.join(root, "etc"), { recursive: true });
    await writeFile(path.join(root, "etc", "os-release"), "PRETTY_NAME=Debian 12\n");
    expect(await readHostOsRelease(root)).toBe("Debian 12");
    await rm(root, { recursive: true, force: true });
  });

  it("returns null without a PRETTY_NAME or without the file", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osr-"));
    await mkdir(path.join(root, "etc"), { recursive: true });
    await writeFile(path.join(root, "etc", "os-release"), "ID=debian\n");
    expect(await readHostOsRelease(root)).toBeNull();
    expect(await readHostOsRelease("/nonexistent")).toBeNull();
    await rm(root, { recursive: true, force: true });
  });
});

const FEATURES = { history: true, processes: true, containers: false };

describe("collectStaticInfo", () => {
  it("prefers device tree + host os-release over systeminformation", async () => {
    const paths = await piFixtures();
    const info = await collectStaticInfo(FEATURES, paths);
    expect(info.model).toBe("Raspberry Pi 5 Model B Rev 1.0");
    expect(info.os).toBe("Raspberry Pi OS Lite (bookworm)");
    expect(info.kernel).toBe("6.6.0");
    expect(info.arch).toBe("arm64");
    expect(info.cpuModel).toBe("ARM Cortex-A76");
    expect(info.cores).toBe(4);
    expect(info.hostname).toBe(os.hostname());
    expect(info.app).toHaveProperty("version");
    expect(info.features).toEqual(FEATURES);
    expect(info.governor).toBe("ondemand");
    expect(info.cpuMaxGhz).toBe(2.4);
    expect(info.storage).toEqual({
      device: "mmcblk0",
      name: "SC32G",
      lifeUsedPercent: 20,
    });
  });

  it("falls back to systeminformation when Pi sources are absent", async () => {
    si.system.mockResolvedValue({ manufacturer: "LENOVO", model: "ThinkPad" });
    const info = await collectStaticInfo(FEATURES, {
      devicetreePath: "/nonexistent",
      hostRoot: "/nonexistent",
      cpufreqRoot: "/nonexistent",
      blockRoot: "/nonexistent",
    });
    expect(info.model).toBe("LENOVO ThinkPad");
    expect(info.os).toBe("Alpine Linux 3.21");
    expect(info.governor).toBeNull();
    expect(info.storage).toBeNull();
  });

  it("degrades to Unknown when nothing identifies the machine", async () => {
    si.system.mockResolvedValue({ manufacturer: "", model: "" });
    si.cpu.mockResolvedValue({ manufacturer: "", brand: "", cores: 0 });
    const info = await collectStaticInfo(FEATURES, {
      devicetreePath: "/nonexistent",
      hostRoot: "/nonexistent",
      cpufreqRoot: "/nonexistent",
      blockRoot: "/nonexistent",
    });
    expect(info.model).toBe("Unknown");
    expect(info.cpuModel).toBe("Unknown");
  });
});

describe("readCpuFreqPolicy", () => {
  it("reads the governor and turns the ceiling into GHz", async () => {
    const root = await fixtureDir({
      cpu0: {
        cpufreq: { scaling_governor: "performance\n", cpuinfo_max_freq: "1800000\n" },
      },
    });
    expect(await readCpuFreqPolicy(root)).toEqual({
      governor: "performance",
      cpuMaxGhz: 1.8,
    });
  });

  it("returns nulls on a kernel without cpufreq", async () => {
    expect(await readCpuFreqPolicy("/nonexistent")).toEqual({
      governor: null,
      cpuMaxGhz: null,
    });
    const zero = await fixtureDir({ cpu0: { cpufreq: { cpuinfo_max_freq: "0\n" } } });
    expect((await readCpuFreqPolicy(zero)).cpuMaxGhz).toBeNull();
  });
});

describe("parseLifeTime", () => {
  it("turns the worst band into a percentage of rated life", () => {
    expect(parseLifeTime("0x01 0x01")).toBe(10);
    expect(parseLifeTime("0x02 0x05")).toBe(50);
    expect(parseLifeTime("0x0b 0x0b")).toBe(100); // beyond the estimate
  });

  it("returns null when the controller reports nothing usable", () => {
    expect(parseLifeTime(null)).toBeNull();
    expect(parseLifeTime("0x00 0x00")).toBeNull();
    expect(parseLifeTime("unknown")).toBeNull();
  });
});

describe("readStorageHealth", () => {
  it("prefers the SD card over other block devices", async () => {
    const root = await fixtureDir({
      "sda": { device: { model: "Portable SSD\n" } },
      "mmcblk0": { device: { name: "SC32G\n", life_time: "0x03 0x01\n" } },
      "loop0": {},
    });
    expect(await readStorageHealth(root)).toEqual({
      device: "mmcblk0",
      name: "SC32G",
      lifeUsedPercent: 30,
    });
  });

  it("falls back to the drive model, without a life estimate", async () => {
    const root = await fixtureDir({ nvme0n1: { device: { model: "WD SN570\n" } } });
    expect(await readStorageHealth(root)).toEqual({
      device: "nvme0n1",
      name: "WD SN570",
      lifeUsedPercent: null,
    });
  });

  it("returns null when nothing looks like a boot device", async () => {
    expect(await readStorageHealth("/nonexistent")).toBeNull();
    expect(await readStorageHealth(await fixtureDir({ loop0: {} }))).toBeNull();
  });
});
