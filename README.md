# raspberry-mopitor

Live monitoring dashboard for Raspberry Pi — a lightweight local web page showing
CPU usage (global + per core), RAM, CPU temperature, disk usage, network throughput
and system info, pushed in real time over WebSocket.

It also reads what a Pi alone can tell you: the firmware **throttle register**
(under-voltage, capped clock, thermal limit — now and since boot), the **power
draw** of a Pi 5, extra **temperature probes** (NVMe, PMIC), the cpufreq
**governor** and the **wear** on the SD card. Disk and network are reported in
full: every mounted filesystem, disk read/write throughput, every interface and
the Wi-Fi signal level.

Beyond the live view it keeps a **history** (charts over 15 min → 7 days), lists the
**top processes**, and — when you opt in — shows **per-container Docker stats**.
The UI is available in English and French (auto-detected from the browser), in a
light or dark theme, installable as an app, with a **kiosk mode** for a Pi driving
a small screen.

Built with Node.js/TypeScript (`systeminformation` + `ws` + the built-in `node:sqlite`,
no HTTP framework) and React + Vite + Tailwind + Recharts. Full design notes in
[docs/SPECS.md](docs/SPECS.md) (French).

## Run with Docker (recommended)

Prebuilt multi-arch images (arm64, amd64) are published to GHCR on every
release — nothing is compiled on the Pi. You only need the compose file:

```bash
curl -fsSLO https://raw.githubusercontent.com/Zeyvo92/raspberry-mopitor/main/docker-compose.yml
docker compose up -d
```

Open `http://<pi-address>:8585`.

The compose file uses `network_mode: host`, `pid: host` and a read-only mount of
`/` so the metrics reflect the **host Pi**, not the container. No `--privileged`
needed. A named volume (`mopitor-data`) holds the history database so it survives
container updates.

### Enabling the Containers tab

Per-container stats read the Docker socket, which the compose file does **not**
mount by default: doing so gives the container root-equivalent control of the
daemon. If you want the tab, uncomment in `docker-compose.yml`:

```yaml
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    group_add:
      - "999"   # getent group docker | cut -d: -f3
```

`group_add` is what lets the unprivileged `node` user read the socket. Without
the mount the tab simply doesn't appear.

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

Node.js 24 is recommended (Node 22.5+ works; older runtimes run fine but
without history, which needs the built-in `node:sqlite`).

```bash
# terminal 1 — server (http://localhost:8585)
cd server && npm install && npm run dev

# terminal 2 — client with hot reload (http://localhost:5173, proxies /ws to :8585)
cd client && npm install && npm run dev
```

Tests (Vitest, 100% coverage enforced in CI): `npm test` in `server/` and
`client/`, or `npm run test:coverage` for the report.

## Configuration

| Env var | Default | Description |
|---|---|---|
| `PORT` | `8585` | HTTP/WebSocket port |
| `REFRESH_INTERVAL_MS` | `1000` | initial sampling interval, clamped to [`100`, `60000`] |
| `DISK_PATH` | `/` | mount point to report (`/host` in Docker) |
| `HOST_ROOT` | `/host` | host root mount, used to read the host's `/etc/os-release` (falls back to the local one) |
| `HWMON_ROOT` | `/sys/class/hwmon` | kernel hwmon root: fan tachometer, extra temperature probes and power rails |
| `THROTTLE_PATH` | *(auto)* | firmware throttle register; empty means the usual Pi locations, `/host` included |
| `CPUFREQ_ROOT` | `/sys/devices/system/cpu` | where the governor and the maximum clock are published |
| `BLOCK_ROOT` | `/sys/block` | sysfs block devices, where SD/eMMC wear is published |
| `PROC_NET_WIRELESS` | `/proc/net/wireless` | Wi-Fi link quality and signal level |
| `STATIC_DIR` | `../client/dist` | built SPA location |
| `UPDATE_CHECK` | `true` | set `false` to disable the release check |
| `UPDATE_CHECK_REPO` | `Zeyvo92/raspberry-mopitor` | repo whose releases define "latest" (for forks) |
| `HISTORY` | `true` | set `false` to keep the monitor strictly live (nothing written to disk) |
| `HISTORY_DB` | `server/data/history.db` | SQLite file (`/data/history.db` in Docker) |
| `HISTORY_INTERVAL_MS` | `10000` | how often a sample is stored |
| `HISTORY_RETENTION_HOURS` | `168` | older samples are pruned automatically |
| `PROCESSES` | `true` | set `false` to hide the process list |
| `PROCESSES_INTERVAL_MS` | `3000` | process sampling interval (only while the tab is open) |
| `PROCESSES_TOP_N` | `12` | rows kept per sort key (top CPU ∪ top memory is sent) |
| `DOCKER_STATS` | `true` | set `false` to skip container stats even if the socket is mounted |
| `DOCKER_SOCKET` | `/var/run/docker.sock` | Docker socket path |
| `DOCKER_INTERVAL_MS` | `3000` | container stats interval (only while the tab is open) |

The refresh rate is shown in the dashboard header and can be changed live
(100ms → 10s presets); the value is shared by all connected viewers.

## Using the dashboard

- **Theme** — system, light or dark, next to the language picker; the choice is
  remembered in the browser.
- **Kiosk mode** — the ⛶ button (or `http://<pi-address>:8585/?kiosk=1`) drops
  the tabs and controls, enlarges the cards, hides the cursor and goes
  fullscreen where the browser allows it. Escape leaves.
- **Install it** — the dashboard ships a web app manifest and a service worker,
  so any browser can add it to a home screen or launch it in its own window. The
  worker is network-first: it never serves a stale build, it only keeps the
  interface openable while the Pi is unreachable.
- **Throttling** — a red banner appears on every tab while the firmware reports
  under-voltage or throttling, and an amber one when it reported either since
  boot. On a Pi, that banner usually means the power supply, not the workload.

## What it costs the Pi

- **Live metrics** are only sampled while at least one browser is connected.
  CPU, memory, disk and network readings come from `/proc` and `statfs(2)`
  directly — no shell is spawned per tick, which matters at a 100 ms refresh.
- **Processes and container stats** are only collected while someone is looking
  at their tab, and at their own slower interval.
- **History** is the one loop that keeps running with nobody connected — that is
  the point of it — but it samples every 10 s by default, reuses the snapshots
  the live loop already collected when a viewer is watching, and writes ~5 MB of
  SQLite per week. `HISTORY=false` turns it off entirely.

## Releasing (maintainers)

1. Bump `version` in `server/package.json` and `client/package.json`,
   commit (`chore(release): vX.Y.Z`)
2. Either push a tag `vX.Y.Z`, or use **Actions → Release → Run workflow**
   and type the version (the tag is created for you — works from the web UI)
3. CI builds the multi-arch image, pushes it to GHCR and creates the GitHub
   Release — which is what running instances compare themselves against

## Roadmap

- **v2** ✅ history + charts, top processes, per-container Docker stats
- **v2.1** ✅ throttling/under-voltage, power draw, extra probes, every
  filesystem and interface, light theme, PWA, kiosk mode
- **next**: threshold alerts (mail/webhook). See [docs/SPECS.md](docs/SPECS.md).

## License

[Apache 2.0](LICENSE)
