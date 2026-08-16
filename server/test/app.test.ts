// Integration tests: real HTTP server, real WebSocket, real collectors.
import type http from "node:http";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import type { ServerMessage } from "../src/types.js";

let staticDir: string;
let server: http.Server;
let base: string;

beforeAll(async () => {
  staticDir = await mkdtemp(path.join(os.tmpdir(), "static-"));
  await writeFile(path.join(staticDir, "index.html"), "<h1>mopitor</h1>");
  await mkdir(path.join(staticDir, "assets"));
  await writeFile(path.join(staticDir, "assets", "app.css"), "body{}");
  await writeFile(path.join(staticDir, "assets", "app.bin"), "binary");

  vi.stubEnv("STATIC_DIR", staticDir);
  vi.resetModules();
  const { createApp } = await import("../src/app.js");
  server = createApp();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await new Promise((resolve) => server.close(resolve));
});

describe("static file serving", () => {
  it("serves index.html at the root", async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("mopitor");
  });

  it("serves assets with their MIME type", async () => {
    const res = await fetch(`${base}/assets/app.css`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/css");
  });

  it("serves unknown extensions as octet-stream", async () => {
    const res = await fetch(`${base}/assets/app.bin`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
  });

  it("falls back to index.html for SPA routes", async () => {
    const res = await fetch(`${base}/some/client/route`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("mopitor");
  });

  it("defaults to the root document when a request has no url", async () => {
    const { serveStatic } = await import("../src/app.js");
    const chunks: unknown[] = [];
    const res = {
      writeHead: vi.fn().mockReturnThis(),
      end: (body: unknown) => chunks.push(body),
    };
    await serveStatic(
      { url: undefined } as http.IncomingMessage,
      res as unknown as http.ServerResponse,
    );
    expect(res.writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({ "Content-Type": expect.stringContaining("html") }),
    );
  });
});

describe("missing frontend build", () => {
  it("returns an actionable 404", async () => {
    const emptyDir = await mkdtemp(path.join(os.tmpdir(), "empty-"));
    vi.stubEnv("STATIC_DIR", emptyDir);
    vi.resetModules();
    const { createApp } = await import("../src/app.js");
    const bare = createApp();
    await new Promise<void>((resolve) => bare.listen(0, "127.0.0.1", resolve));
    const port = (bare.address() as AddressInfo).port;

    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("npm run build");

    await new Promise((resolve) => bare.close(resolve));
    vi.stubEnv("STATIC_DIR", staticDir);
  });
});

describe("websocket end to end", () => {
  it("streams static, config then real metrics on /ws", async () => {
    const ws = new WebSocket(`${base.replace("http", "ws")}/ws`);
    const received: ServerMessage[] = [];

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("timeout")), 8000);
      ws.on("message", (raw) => {
        received.push(JSON.parse(raw.toString()) as ServerMessage);
        if (received.some((m) => m.type === "metrics")) {
          clearTimeout(timeout);
          resolve();
        }
      });
      ws.on("error", reject);
    });
    ws.close();

    const types = received.map((m) => m.type);
    expect(types[0]).toBe("static");
    expect(types[1]).toBe("config");
    expect(types).toContain("metrics");

    const metrics = received.find((m) => m.type === "metrics");
    if (metrics?.type !== "metrics") throw new Error("unreachable");
    // real collectors ran on this machine
    expect(metrics.data.memory.total).toBeGreaterThan(0);
    expect(metrics.data.cpu.perCore.length).toBeGreaterThan(0);
    expect(metrics.data.uptime).toBeGreaterThan(0);
  }, 15_000);
});
