import { writeFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const si = vi.hoisted(() => ({
  dockerContainers: vi.fn(),
  dockerContainerStats: vi.fn(),
}));
vi.mock("systeminformation", () => ({ default: si }));

import { createContainerReader, isDockerAvailable } from "../src/metrics/docker.js";

const container = (over: Record<string, unknown> = {}) => ({
  id: "9f2c1b4a5e6d7c8b9a0f1e2d",
  name: "pihole",
  image: "pihole/pihole",
  state: "running",
  started: 1_700_000_000,
  ...over,
});

const stats = (over: Record<string, unknown> = {}) => ({
  id: "9f2c1b4a5e6d",
  cpuPercent: 1.44,
  memUsage: 100,
  memLimit: 1000,
  netIO: { rx: 1000, wx: 500 },
  ...over,
});

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.useRealTimers());

describe("isDockerAvailable", () => {
  it("is true when the socket path exists", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "mopitor-sock-"));
    const socket = path.join(dir, "docker.sock");
    await writeFile(socket, "");
    expect(await isDockerAvailable(socket)).toBe(true);
    await rm(dir, { recursive: true, force: true });
  });

  it("is false when it is not mounted", async () => {
    expect(await isDockerAvailable("/nonexistent/docker.sock")).toBe(false);
  });

  it("is false when container stats are turned off", async () => {
    vi.resetModules();
    vi.stubEnv("DOCKER_STATS", "false");
    const { isDockerAvailable: reloaded } = await import("../src/metrics/docker.js");
    expect(await reloaded("/nonexistent")).toBe(false);
    vi.unstubAllEnvs();
    vi.resetModules();
  });
});

describe("collectContainers", () => {
  it("joins containers with their stats and shortens the id", async () => {
    si.dockerContainers.mockResolvedValue([container()]);
    si.dockerContainerStats.mockResolvedValue([stats()]);

    const { list } = await createContainerReader()();
    expect(list[0]).toMatchObject({
      id: "9f2c1b4a5e6d",
      name: "pihole",
      state: "running",
      cpuPercent: 1.4,
      memUsage: 100,
      memLimit: 1000,
      startedAt: 1_700_000_000_000,
    });
  });

  it("reports rates only once it has two samples to compare", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    si.dockerContainers.mockResolvedValue([container()]);
    si.dockerContainerStats.mockResolvedValue([stats()]);
    const read = createContainerReader();

    expect((await read()).list[0]).toMatchObject({ netRxSec: null, netTxSec: null });

    vi.setSystemTime(1_002_000); // +2s
    si.dockerContainerStats.mockResolvedValue([stats({ netIO: { rx: 3000, wx: 1500 } })]);
    expect((await read()).list[0]).toMatchObject({ netRxSec: 1000, netTxSec: 500 });
  });

  it("never reports a negative rate when a container restarts its counters", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    si.dockerContainers.mockResolvedValue([container()]);
    si.dockerContainerStats.mockResolvedValue([stats({ netIO: { rx: 9000, wx: 9000 } })]);
    const read = createContainerReader();
    await read();

    vi.setSystemTime(1_001_000);
    si.dockerContainerStats.mockResolvedValue([stats({ netIO: { rx: 10, wx: 10 } })]);
    expect((await read()).list[0]).toMatchObject({ netRxSec: 0, netTxSec: 0 });
  });

  it("forgets containers that disappeared, so rates restart clean", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    si.dockerContainers.mockResolvedValue([container()]);
    si.dockerContainerStats.mockResolvedValue([stats()]);
    const read = createContainerReader();
    await read();

    si.dockerContainers.mockResolvedValue([]);
    si.dockerContainerStats.mockResolvedValue([]);
    vi.setSystemTime(1_001_000);
    expect((await read()).list).toEqual([]);

    si.dockerContainers.mockResolvedValue([container()]);
    si.dockerContainerStats.mockResolvedValue([stats({ netIO: { rx: 5000, wx: 5000 } })]);
    vi.setSystemTime(1_002_000);
    expect((await read()).list[0]).toMatchObject({ netRxSec: null });
  });

  it("leaves stats null for a container that is not running", async () => {
    si.dockerContainers.mockResolvedValue([
      container({ id: "dead", state: "exited", started: 0 }),
    ]);
    si.dockerContainerStats.mockResolvedValue([]);

    expect((await createContainerReader()()).list[0]).toMatchObject({
      state: "exited",
      cpuPercent: null,
      memUsage: null,
      netRxSec: null,
      startedAt: 0,
    });
  });

  it("sorts running containers first, then by CPU, then by name", async () => {
    si.dockerContainers.mockResolvedValue([
      container({ id: "aaa", name: "zulu", state: "exited" }),
      container({ id: "bbb", name: "bravo", state: "running" }),
      container({ id: "ccc", name: "alpha", state: "running" }),
      container({ id: "ddd", name: "delta", state: "running" }),
    ]);
    si.dockerContainerStats.mockResolvedValue([
      stats({ id: "bbb", cpuPercent: 5 }),
      stats({ id: "ccc", cpuPercent: 5 }),
      stats({ id: "ddd", cpuPercent: 50 }),
    ]);

    const names = (await createContainerReader()()).list.map((c) => c.name);
    expect(names).toEqual(["delta", "alpha", "bravo", "zulu"]);
  });

  it("returns an empty list and complains once when the socket refuses", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    si.dockerContainers.mockRejectedValue(new Error("EACCES"));
    const read = createContainerReader();

    expect((await read()).list).toEqual([]);
    expect((await read()).list).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);

    si.dockerContainers.mockResolvedValue([container()]);
    si.dockerContainerStats.mockResolvedValue([stats()]);
    expect((await read()).list).toHaveLength(1);

    // permission restored then lost again: it is worth saying so a second time
    si.dockerContainers.mockRejectedValue(new Error("EACCES"));
    await read();
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("treats a non-finite cpu reading as zero", async () => {
    si.dockerContainers.mockResolvedValue([container()]);
    si.dockerContainerStats.mockResolvedValue([stats({ cpuPercent: Number.NaN })]);
    expect((await createContainerReader()()).list[0]?.cpuPercent).toBe(0);
  });
});
