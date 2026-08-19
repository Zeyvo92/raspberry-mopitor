/* v8 ignore file -- process bootstrap: everything it wires is tested via app.ts */
import { createApp } from "./app.js";
import { config } from "./config.js";
import { EnergyMeter } from "./history/energy.js";
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
// Energy is integrated from the samples the recorder takes, and persisted in
// the same database: without one there is nothing to accumulate into, and the
// dashboard shows the live draw only.
const energy = history
  ? new EnergyMeter({
      store: history,
      pricePerKwh: config.energyPrice,
      currency: config.energyCurrency,
      // a gap wider than a few recording intervals means the Pi (or the
      // container) was not running — don't bill it at the last known wattage
      maxGapMs: config.historyIntervalMs * 3,
    })
  : null;
const recorder = history
  ? new HistoryRecorder(history, config.historyIntervalMs, energy)
  : null;
recorder?.start();

const server = createApp({ history, recorder, energy });
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
