/* v8 ignore file -- process bootstrap: everything it wires is tested via app.ts */
import { createApp } from "./app.js";
import { config } from "./config.js";
import { HistoryRecorder } from "./history/recorder.js";
import { openHistoryStore } from "./history/store.js";
import { startUpdateChecker } from "./version.js";

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

const server = createApp({ history, recorder });
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
