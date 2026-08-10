# raspberry-mopitor

Live monitoring dashboard for Raspberry Pi — a lightweight local web page showing
CPU usage (global + per core), RAM, CPU temperature, disk usage, network throughput
and system info, pushed in real time over WebSocket.

Built with Node.js/TypeScript (`systeminformation` + `ws`, no HTTP framework) and
React + Vite + Tailwind. Full design notes in [docs/SPECS.md](docs/SPECS.md) (French).

## Run with Docker (recommended)

```bash
git clone https://github.com/zeyvo92/raspberry-mopitor.git
cd raspberry-mopitor
docker compose up -d --build
```

Open `http://<pi-address>:8585`.

The compose file uses `network_mode: host`, `pid: host` and a read-only mount of
`/` so the metrics reflect the **host Pi**, not the container. No `--privileged`
needed.

## Run for development

```bash
# terminal 1 — server (http://localhost:8585)
cd server && npm install && npm run dev

# terminal 2 — client with hot reload (http://localhost:5173, proxies /ws to :8585)
cd client && npm install && npm run dev
```

## Configuration

| Env var | Default | Description |
|---|---|---|
| `PORT` | `8585` | HTTP/WebSocket port |
| `REFRESH_INTERVAL_MS` | `1000` | initial sampling interval, clamped to [`100`, `60000`] |
| `DISK_PATH` | `/` | mount point to report (`/host` in Docker) |
| `STATIC_DIR` | `../client/dist` | built SPA location |

The refresh rate is shown in the dashboard header and can be changed live
(100ms → 10s presets); the value is shared by all connected viewers.
Metrics are only sampled while at least one browser is connected — an idle
monitor costs the Pi nothing.

## Roadmap

- **v2**: history + charts (Recharts), top processes, per-container Docker stats,
  threshold alerts. See [docs/SPECS.md](docs/SPECS.md).

## License

[Apache 2.0](LICENSE)
