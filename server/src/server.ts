/* v8 ignore file -- process bootstrap: everything it wires is tested via app.ts */
import { createApp } from "./app.js";
import { config } from "./config.js";
import { startUpdateChecker } from "./version.js";

const server = createApp();
startUpdateChecker();

server.listen(config.port, () => {
  console.log(`raspberry-mopitor listening on http://localhost:${config.port}`);
  console.log(
    `refresh: ${config.refreshIntervalMs}ms · disk: ${config.diskPath} · static: ${config.staticDir}`,
  );
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close();
    process.exit(0);
  });
}
