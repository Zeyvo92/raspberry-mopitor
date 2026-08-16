/** Source dictionary. Every other language is typed against this object. */
export const en = {
  // header
  "header.connected": "connected",
  "header.disconnected": "disconnected — reconnecting",
  "header.uptime": "up",
  "header.refresh": "refresh",
  "header.refreshHint": "Sampling interval — shared by all connected viewers",
  "header.updateAvailable": "v{version} available",
  "header.updateHint": "You are running v{current} — v{latest} is available",
  "header.language": "Language",

  // tabs
  "tab.dashboard": "Dashboard",
  "tab.history": "History",
  "tab.processes": "Processes",
  "tab.containers": "Containers",

  // connection states
  "state.connecting": "Connecting…",
  "state.waiting": "Waiting for metrics…",
  "state.loading": "Loading…",

  // cards
  "cpu.title": "CPU",
  "cpu.loadAvg": "load avg {values}",
  "cpu.core": "c{index}",
  "memory.title": "Memory",
  "memory.ram": "RAM",
  "memory.swap": "swap",
  "memory.sub": "of {total} · {available} available",
  "temperature.title": "Temperature",
  "temperature.cpu": "CPU",
  "temperature.throttle": "⚠ approaching throttle limit",
  "temperature.noSensor": "No sensor available",
  "temperature.fan": "fan",
  "temperature.fanStopped": "(stopped)",
  "disk.title": "Disk ({mount})",
  "disk.sub": "of {total}",
  "network.title": "Network ({iface})",
  "network.download": "download",
  "network.upload": "upload",

  // history
  "history.range": "range",
  "history.disabled":
    "History is disabled on this server (HISTORY=false, or the database could not be opened).",
  "history.empty": "No samples recorded for this range yet.",
  "history.recording": "one sample every {interval} · kept {hours} h",
  "history.cpu": "CPU load",
  "history.temperature": "CPU temperature",
  "history.memory": "Memory used",
  "history.network": "Network throughput",
  "history.min": "min",
  "history.avg": "avg",
  "history.max": "max",
  "history.now": "now",
  "range.15m": "15 min",
  "range.1h": "1 h",
  "range.6h": "6 h",
  "range.24h": "24 h",
  "range.7d": "7 days",

  // processes
  "processes.title": "Top processes",
  "processes.summary": "{total} processes · {running} running · {sleeping} sleeping",
  "processes.sortBy": "sort by",
  "processes.pid": "PID",
  "processes.name": "Process",
  "processes.user": "User",
  "processes.cpu": "CPU",
  "processes.memory": "Memory",
  "processes.command": "Command",
  "processes.empty": "No process data yet.",

  // containers
  "containers.title": "Docker containers",
  "containers.summary": "{running} running · {total} total",
  "containers.name": "Container",
  "containers.image": "Image",
  "containers.state": "State",
  "containers.cpu": "CPU",
  "containers.memory": "Memory",
  "containers.network": "Network",
  "containers.uptime": "Up",
  "containers.empty": "No containers on this host.",
  "containers.unavailable":
    "The Docker socket is not mounted — see docker-compose.yml to enable container stats.",
} as const;

export type TranslationKey = keyof typeof en;

/** every language ships the same keys — missing or extra ones fail the build */
export type Dictionary = Record<TranslationKey, string>;
