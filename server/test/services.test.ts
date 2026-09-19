import path from "node:path";
import { writeFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServicesReader, parseHealth } from "../src/metrics/services.js";
import { cleanupFixtures, fixtureDir } from "./fixtures.js";

const health = (status: string, message = "", updatedAt = "2026-09-19T10:12:26Z") =>
  JSON.stringify({ status, message, updatedAt });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_700_000_000_000);
});

afterEach(async () => {
  vi.useRealTimers();
  await cleanupFixtures();
});

describe("parseHealth", () => {
  it("reads the three fields the convention defines", () => {
    expect(parseHealth("claude-rc", health("ok"))).toEqual({
      name: "claude-rc",
      status: "ok",
      message: "",
      updatedAt: "2026-09-19T10:12:26Z",
    });
    expect(parseHealth("claude-rc", health("failed", "OAuth token expired"))).toEqual({
      name: "claude-rc",
      status: "failed",
      message: "OAuth token expired",
      updatedAt: "2026-09-19T10:12:26Z",
    });
  });

  it("treats a status it doesn't know as unknown", () => {
    expect(parseHealth("svc", health("degraded")).status).toBe("unknown");
    expect(parseHealth("svc", JSON.stringify({})).status).toBe("unknown");
  });

  it("drops fields of the wrong type rather than the whole reading", () => {
    const parsed = parseHealth(
      "svc",
      JSON.stringify({ status: "failed", message: 42, updatedAt: 1_700_000 }),
    );
    expect(parsed).toEqual({
      name: "svc",
      status: "failed",
      message: "",
      updatedAt: null,
    });
  });

  it("trims and bounds the message a shell script wrote", () => {
    const parsed = parseHealth(
      "svc",
      JSON.stringify({ status: "failed", message: `  ${"x".repeat(500)}  ` }),
    );
    expect(parsed.message).toBe("x".repeat(200));
  });

  it("survives junk and JSON that isn't an object", () => {
    expect(parseHealth("svc", "not json")).toEqual({
      name: "svc",
      status: "unknown",
      message: "",
      updatedAt: null,
    });
    expect(parseHealth("svc", "null").status).toBe("unknown");
    expect(parseHealth("svc", '"ok"').status).toBe("unknown");
  });
});

describe("createServicesReader", () => {
  it("collects nothing when no service is watched", async () => {
    expect(await createServicesReader([], 30_000)()).toEqual([]);
  });

  it("reads one file per watched service, in the configured order", async () => {
    const root = await fixtureDir({
      "rc.json": health("ok"),
      "backup.json": health("failed", "rsync exited 23"),
    });
    const read = createServicesReader(
      [
        { name: "claude-rc", path: path.join(root, "rc.json") },
        { name: "backup", path: path.join(root, "backup.json") },
      ],
      30_000,
    );

    expect(await read()).toEqual([
      {
        name: "claude-rc",
        status: "ok",
        message: "",
        updatedAt: "2026-09-19T10:12:26Z",
      },
      {
        name: "backup",
        status: "failed",
        message: "rsync exited 23",
        updatedAt: "2026-09-19T10:12:26Z",
      },
    ]);
  });

  it("reports a service that has never written its file as unknown", async () => {
    expect(
      await createServicesReader([{ name: "svc", path: "/nonexistent" }], 30_000)(),
    ).toEqual([{ name: "svc", status: "unknown", message: "", updatedAt: null }]);
  });

  it("re-reads on its own interval, not on every tick of the live loop", async () => {
    const root = await fixtureDir({ "rc.json": health("ok") });
    const file = path.join(root, "rc.json");
    const read = createServicesReader([{ name: "claude-rc", path: file }], 30_000);
    expect((await read())[0]?.status).toBe("ok");

    await writeFile(file, health("failed", "token expired"));
    vi.setSystemTime(1_700_000_029_000);
    expect((await read())[0]?.status).toBe("ok"); // still the cached reading

    vi.setSystemTime(1_700_000_031_000);
    expect((await read())[0]).toMatchObject({
      status: "failed",
      message: "token expired",
    });
  });
});
