# raspberry-mopitor

Live monitoring dashboard for Raspberry Pi — a lightweight local web page showing
CPU usage (global + per core), RAM, CPU temperature, disk usage, network throughput
and system info, pushed in real time over WebSocket.

It also reads what a Pi alone can tell you: the firmware **throttle register**
(under-voltage, capped clock, thermal limit — now and since boot), the **power
draw** — measured on a Pi 5, modelled from the board and the CPU load
everywhere else — and the **energy** it adds up to (kWh today, this week, this
month, with the bill if you tell it your tariff). Plus extra **temperature
probes** (NVMe, PMIC), the cpufreq **governor** and the **wear** on the SD
card. Disk and network are reported in
full: every mounted filesystem, disk read/write throughput, every interface and
the Wi-Fi signal level.

When something feels slow it says why, rather than leaving you to guess: kernel
**pressure (PSI)**, the CPU's **iowait** share, **disk latency and busy time**,
**swap traffic**, **packet errors and drops**, the **negotiated link speed** and
**TCP retransmissions**. Two failures a Pi otherwise hides — a filesystem the
kernel has remounted **read-only** and processes killed by the **OOM killer** —
are called out on the card itself.

Beyond the live view it keeps a **history** (charts over 15 min → 7 days, power
and I/O wait included), lists the
**top processes**, and — when you opt in — shows **per-container Docker stats**.
The UI is available in English and French (auto-detected from the browser), in a
light or dark theme, installable as an app, with a **kiosk mode** for a Pi driving
a small screen. Every card can be hidden and every detail row folded away from
the **⚙ display menu**, so the dashboard stays as short as you want it.

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
| `POWER_ESTIMATE` | `true` | set `false` to hide the modelled draw on boards with no power sensor |
| `POWER_IDLE_W` | *(board profile)* | draw at idle in watts — overrides the profile, e.g. measured with a wattmeter |
| `POWER_MAX_W` | *(board profile)* | draw with every core busy, in watts |
| `ENERGY_PRICE` | `0` | price of a kWh; `0` shows the kWh without any cost |
| `ENERGY_CURRENCY` | `€` | symbol printed next to a cost (no conversion is done) |
| `STATIC_DIR` | `../client/dist` | built SPA location |
| `UPDATE_CHECK` | `true` | set `false` to disable the release check |
| `UPDATE_CHECK_REPO` | `Zeyvo92/raspberry-mopitor` | repo whose releases define "latest" (for forks) |
| `HISTORY` | `true` | set `false` to keep the monitor strictly live (nothing written to disk — and no energy counters) |
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

- **Display (⚙)** — pick which cards this browser shows, and whether they show
  their **detailed rows** (iowait, inodes, packet errors, disk latency…). Both
  are remembered per browser, so the Pi driving a wall screen and the phone in
  your pocket can show different things. Detailed rows are **off by default**:
  the dashboard looks exactly as it always has until you ask for more. What
  never hides is an anomaly — a read-only filesystem, an OOM kill, a card
  reporting end-of-life wear.
- **Theme** — system, light or dark, next to the language picker; the choice is
  remembered in the browser.
- **Kiosk mode** — the ⛶ button (or `http://<pi-address>:8585/?kiosk=1`) drops
  the tabs and controls, enlarges the cards, hides the cursor and goes
  fullscreen where the browser allows it. Escape leaves.
- **Install it** — the dashboard ships a web app manifest and a service worker,
  so any browser can add it to a home screen or launch it in its own window. The
  worker is network-first: it never serves a stale build, it only keeps the
  interface openable while the Pi is unreachable.
- **Consumption** — a Pi 5 measures itself through its PMIC and the card shows
  each rail. Any other board has no sensor at all, so the figure is modelled
  from what that board draws idle and busy, scaled by the CPU load, and shown
  with a "≈" (hover it for the details). `POWER_IDLE_W` and `POWER_MAX_W`
  calibrate it against a wattmeter; `POWER_ESTIMATE=false` turns it off. The
  kWh counters underneath are integrated by the history loop, so they keep
  adding up with nobody watching, and survive a restart. Set `ENERGY_PRICE` to
  what your utility charges to see what the Pi actually costs you.
- **Pressure** — the share of the last ten seconds during which at least one
  task was stalled waiting for the CPU, the disk or memory. It is the shortest
  answer to "why is this slow": load average counts processes that want to run,
  pressure counts the time they actually lost. The card only appears on kernels
  built with PSI.
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
- **Energy** rides along with that loop: one multiplication per sample and one
  row per day, so the counters cost nothing beyond the history itself.
- **The diagnostic readings** are ordinary `/proc` and `/sys` files, and the
  slow-moving ones (pressure, the memory breakdown, TCP counters, link speed)
  are cached for a second or more — at a 100 ms refresh they would otherwise be
  re-read a hundred times to show the same number.

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
- **v2.2** ✅ power on every board (measured or modelled), energy counters and
  cost, power history
- **v2.3** ✅ diagnostic metrics (PSI, iowait, disk latency, inodes, read-only
  mounts, swap traffic, OOM kills, packet errors, link speed, TCP retransmits,
  card pre-EOL) and a per-browser display menu
- **next**: threshold alerts (mail/webhook). See [docs/SPECS.md](docs/SPECS.md).

## License

[Apache 2.0](LICENSE)
