# raspberry-mopitor

Live monitoring dashboard for Raspberry Pi — a lightweight local web page showing
CPU usage (global + per core), RAM, CPU temperature, disk usage, network throughput
and system info, pushed in real time over WebSocket.

Built with Node.js/TypeScript (`systeminformation` + `ws`, no HTTP framework) and
React + Vite + Tailwind. Full design notes in [docs/SPECS.md](docs/SPECS.md) (French).

## Run with Docker (recommended)

Prebuilt multi-arch images (arm64, armv7, amd64) are published to GHCR on every
release — nothing is compiled on the Pi. You only need the compose file:

```bash
curl -fsSLO https://raw.githubusercontent.com/Zeyvo92/raspberry-mopitor/main/docker-compose.yml
docker compose up -d
```

Open `http://<pi-address>:8585`.

The compose file uses `network_mode: host`, `pid: host` and a read-only mount of
`/` so the metrics reflect the **host Pi**, not the container. No `--privileged`
needed.

## Updating

The server checks GitHub for the latest release at startup (then twice a day)
and the dashboard header shows a **"vX.Y.Z available"** badge when you're
behind. To update:

```bash
docker compose pull && docker compose up -d
```

For fully automatic updates, run [Watchtower](https://containrrr.dev/watchtower/)
on your Pi — it redeploys the container whenever a new image is published.
The check is anonymous (one HTTPS request to api.github.com) and can be
disabled with `UPDATE_CHECK=false`; an offline Pi simply skips it.

## Build from source

```bash
git clone https://github.com/Zeyvo92/raspberry-mopitor.git
cd raspberry-mopitor
docker compose -f docker-compose.build.yml up -d --build
```

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
| `UPDATE_CHECK` | `true` | set `false` to disable the release check |
| `UPDATE_CHECK_REPO` | `Zeyvo92/raspberry-mopitor` | repo whose releases define "latest" (for forks) |

The refresh rate is shown in the dashboard header and can be changed live
(100ms → 10s presets); the value is shared by all connected viewers.
Metrics are only sampled while at least one browser is connected — an idle
monitor costs the Pi nothing.

## Releasing (maintainers)

1. Bump `version` in `server/package.json` and `client/package.json`,
   commit (`chore(release): vX.Y.Z`)
2. Either push a tag `vX.Y.Z`, or use **Actions → Release → Run workflow**
   and type the version (the tag is created for you — works from the web UI)
3. CI builds the multi-arch image, pushes it to GHCR and creates the GitHub
   Release — which is what running instances compare themselves against

## Roadmap

- **v2**: history + charts (Recharts), top processes, per-container Docker stats,
  threshold alerts. See [docs/SPECS.md](docs/SPECS.md).

## License

[Apache 2.0](LICENSE)
