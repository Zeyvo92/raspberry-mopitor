import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

type VersionModule = typeof import("../src/version.js");

async function loadVersion(env: Record<string, string>): Promise<VersionModule> {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  return await import("../src/version.js");
}

function mockGithub(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ base: string; requests: () => number; close: () => void }> {
  let count = 0;
  const server = http.createServer((req, res) => {
    count++;
    handler(req, res);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        base: `http://127.0.0.1:${port}`,
        requests: () => count,
        close: () => server.close(),
      });
    });
  });
}

const waitFor = async (predicate: () => boolean, timeoutMs = 3000) => {
  const start = Date.now();
  while (!predicate() && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 20));
  }
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("parseSemver / compareVersions", () => {
  it("parses release-style versions", async () => {
    const { parseSemver } = await loadVersion({});
    expect(parseSemver("1.2.3")).toEqual([1, 2, 3]);
    expect(parseSemver("v10.0.1")).toEqual([10, 0, 1]);
    expect(parseSemver(" 0.1.0 ")).toEqual([0, 1, 0]);
    expect(parseSemver("dev")).toBeNull();
    expect(parseSemver("1.2")).toBeNull();
  });

  it("orders versions and never flags unparsable ones", async () => {
    const { compareVersions } = await loadVersion({});
    expect(compareVersions("0.2.0", "0.1.0")).toBeGreaterThan(0);
    expect(compareVersions("0.1.0", "0.1.1")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "0.9.9")).toBeGreaterThan(0);
    expect(compareVersions("0.1.0", "0.1.0")).toBe(0);
    expect(compareVersions("1.0.0", "dev")).toBe(0);
    expect(compareVersions("dev", "1.0.0")).toBe(0);
  });
});

describe("own version resolution", () => {
  it("prefers APP_VERSION and strips the leading v", async () => {
    const { getAppInfo } = await loadVersion({ APP_VERSION: "v9.9.9" });
    expect(getAppInfo().version).toBe("9.9.9");
  });

  it("falls back to package.json", async () => {
    const { getAppInfo } = await loadVersion({});
    // whatever the current package version is, it must parse as semver
    const { parseSemver } = await loadVersion({});
    expect(parseSemver(getAppInfo().version)).not.toBeNull();
  });

  it("falls back to 'dev' when package.json is unreadable", async () => {
    vi.resetModules();
    vi.doMock("node:fs", () => ({
      readFileSync: () => {
        throw new Error("nope");
      },
    }));
    const { getAppInfo } = await import("../src/version.js");
    expect(getAppInfo().version).toBe("dev");
    vi.doUnmock("node:fs");
  });

  it("falls back to 'dev' when package.json has no version field", async () => {
    vi.resetModules();
    vi.doMock("node:fs", () => ({ readFileSync: () => "{}" }));
    const { getAppInfo } = await import("../src/version.js");
    expect(getAppInfo().version).toBe("dev");
    vi.doUnmock("node:fs");
  });
});

describe("update checker", () => {
  it("flags an available update from the latest release", async () => {
    const gh = await mockGithub((req, res) => {
      expect(req.url).toBe("/repos/Zeyvo92/raspberry-mopitor/releases/latest");
      res.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          tag_name: "v2.0.0",
          html_url: "https://github.com/x/releases/tag/v2.0.0",
        }),
      );
    });
    const mod = await loadVersion({
      APP_VERSION: "1.0.0",
      UPDATE_CHECK_API: gh.base,
    });
    mod.startUpdateChecker();
    await waitFor(() => mod.getAppInfo().latestVersion !== null);
    gh.close();

    expect(mod.getAppInfo()).toEqual({
      version: "1.0.0",
      latestVersion: "2.0.0",
      updateAvailable: true,
      releaseUrl: "https://github.com/x/releases/tag/v2.0.0",
    });
  });

  it("reports up to date when running the latest release", async () => {
    const gh = await mockGithub((_req, res) => {
      res.writeHead(200).end(JSON.stringify({ tag_name: "v1.0.0" }));
    });
    const mod = await loadVersion({
      APP_VERSION: "1.0.0",
      UPDATE_CHECK_API: gh.base,
    });
    mod.startUpdateChecker();
    await waitFor(() => mod.getAppInfo().latestVersion !== null);
    gh.close();

    const info = mod.getAppInfo();
    expect(info.updateAvailable).toBe(false);
    // no html_url in the payload -> canonical fallback link
    expect(info.releaseUrl).toBe(
      "https://github.com/Zeyvo92/raspberry-mopitor/releases/latest",
    );
  });

  it("stays silent on API errors (404: no release yet)", async () => {
    const gh = await mockGithub((_req, res) => res.writeHead(404).end("{}"));
    const mod = await loadVersion({
      APP_VERSION: "1.0.0",
      UPDATE_CHECK_API: gh.base,
    });
    mod.startUpdateChecker();
    await waitFor(() => gh.requests() > 0);
    await new Promise((r) => setTimeout(r, 50));
    gh.close();

    expect(mod.getAppInfo().latestVersion).toBeNull();
    expect(mod.getAppInfo().updateAvailable).toBe(false);
  });

  it("ignores payloads without a tag_name", async () => {
    const gh = await mockGithub((_req, res) => res.writeHead(200).end("{}"));
    const mod = await loadVersion({
      APP_VERSION: "1.0.0",
      UPDATE_CHECK_API: gh.base,
    });
    mod.startUpdateChecker();
    await waitFor(() => gh.requests() > 0);
    await new Promise((r) => setTimeout(r, 50));
    gh.close();

    expect(mod.getAppInfo().latestVersion).toBeNull();
  });

  it("survives an unreachable API (offline Pi)", async () => {
    const mod = await loadVersion({
      APP_VERSION: "1.0.0",
      // nothing listens there
      UPDATE_CHECK_API: "http://127.0.0.1:1",
    });
    mod.startUpdateChecker();
    await new Promise((r) => setTimeout(r, 100));
    expect(mod.getAppInfo().latestVersion).toBeNull();
  });

  it("retries on the fast delay until the first success, then settles down", async () => {
    let calls = 0;
    const gh = await mockGithub((_req, res) => {
      calls++;
      if (calls === 1) {
        res.writeHead(404).end("{}"); // network up but no release yet
      } else {
        res.writeHead(200).end(JSON.stringify({ tag_name: "v3.0.0" }));
      }
    });

    // capture the checker's long-delay reschedules; everything else (test
    // helpers, sockets) keeps using the real setTimeout
    const scheduled: Array<{ cb: () => void; delay: number }> = [];
    const realSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((
      cb: () => void,
      delay?: number,
      ...args: unknown[]
    ) => {
      if (typeof delay === "number" && delay >= 60_000) {
        scheduled.push({ cb, delay });
        return { unref: () => undefined } as unknown as NodeJS.Timeout;
      }
      return realSetTimeout(cb, delay, ...(args as []));
    }) as typeof setTimeout);

    const mod = await loadVersion({
      APP_VERSION: "1.0.0",
      UPDATE_CHECK_API: gh.base,
    });
    mod.startUpdateChecker();
    await waitFor(() => scheduled.length === 1);
    expect(mod.getAppInfo().latestVersion).toBeNull();
    expect(scheduled[0]!.delay).toBe(5 * 60 * 1000); // fast retry after failure

    scheduled[0]!.cb(); // fire the retry
    await waitFor(() => scheduled.length === 2);
    gh.close();

    expect(mod.getAppInfo().latestVersion).toBe("3.0.0");
    expect(mod.getAppInfo().updateAvailable).toBe(true);
    expect(scheduled[1]!.delay).toBe(6 * 60 * 60 * 1000); // normal cadence
  });

  it("does nothing when UPDATE_CHECK=false", async () => {
    const gh = await mockGithub((_req, res) => res.writeHead(200).end("{}"));
    const mod = await loadVersion({
      UPDATE_CHECK: "false",
      UPDATE_CHECK_API: gh.base,
    });
    mod.startUpdateChecker();
    await new Promise((r) => setTimeout(r, 100));
    gh.close();
    expect(gh.requests()).toBe(0);
  });
});
