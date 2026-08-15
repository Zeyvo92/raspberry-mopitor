import http from "node:http";
import path from "node:path";
import { promises as fs } from "node:fs";
import { WebSocketServer } from "ws";
import { config } from "./config.js";
import { Hub } from "./ws/hub.js";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".json": "application/json; charset=utf-8",
};

export async function serveStatic(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;

  // Defense in depth: WHATWG URL parsing already normalizes every dot-segment
  // form (including %2e variants) out of pathname, so this branch should be
  // unreachable — it only exists to fail closed if that ever changes.
  const filePath = path.join(config.staticDir, requested);
  /* v8 ignore start */
  if (!filePath.startsWith(config.staticDir + path.sep)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  /* v8 ignore stop */

  try {
    const body = await fs.readFile(filePath);
    const type = MIME_TYPES[path.extname(filePath)] ?? "application/octet-stream";
    res.writeHead(200, { "Content-Type": type }).end(body);
  } catch {
    // SPA fallback: unknown paths get index.html, real 404 only if no build exists
    try {
      const index = await fs.readFile(path.join(config.staticDir, "index.html"));
      res.writeHead(200, { "Content-Type": MIME_TYPES[".html"]! }).end(index);
    } catch {
      res
        .writeHead(404, { "Content-Type": "text/plain; charset=utf-8" })
        .end("Frontend build not found. Run `npm run build` in client/ first.");
    }
  }
}

/** HTTP static serving + /ws upgrade wired to a Hub. Not listening yet. */
export function createApp(): http.Server {
  const server = http.createServer((req, res) => void serveStatic(req, res));
  const wss = new WebSocketServer({ server, path: "/ws" });
  const hub = new Hub();
  wss.on("connection", (ws) => void hub.add(ws));
  return server;
}
