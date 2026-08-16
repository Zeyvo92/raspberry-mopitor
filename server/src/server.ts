import http from "node:http";
import path from "node:path";
import { promises as fs } from "node:fs";
import { WebSocketServer } from "ws";
import { config } from "./config.js";
import { HistoryRecorder } from "./history/recorder.js";
import { openHistoryStore } from "./history/store.js";
import { startUpdateChecker } from "./version.js";
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

async function serveStatic(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;

  // Resolve inside staticDir only — reject path traversal.
  const filePath = path.join(config.staticDir, requested);
  if (!filePath.startsWith(config.staticDir + path.sep)) {
    res.writeHead(403).end("Forbidden");
    return;
  }

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

const server = http.createServer((req, res) => void serveStatic(req, res));

// Opened before the first client connects so the "static" message can tell
// the UI whether the history tab has anything to show.
const history = config.history
  ? await openHistoryStore({
      file: config.historyDb,
      intervalMs: config.historyIntervalMs,
      retentionHours: config.historyRetentionHours,
    })
  : null;
const recorder = history ? new HistoryRecorder(history, config.historyIntervalMs) : null;
recorder?.start();

const wss = new WebSocketServer({ server, path: "/ws" });
const hub = new Hub({ history, recorder });
wss.on("connection", (ws) => void hub.add(ws));

startUpdateChecker();

server.listen(config.port, () => {
  console.log(`raspberry-mopitor listening on http://localhost:${config.port}`);
  console.log(
    `refresh: ${config.refreshIntervalMs}ms · disk: ${config.diskPath} · static: ${config.staticDir}`,
  );
  console.log(
    history
      ? `history: ${config.historyDb} · every ${config.historyIntervalMs}ms · kept ${config.historyRetentionHours}h`
      : "history: disabled (live metrics only)",
  );
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close();
    recorder?.stop();
    history?.close();
    process.exit(0);
  });
}
