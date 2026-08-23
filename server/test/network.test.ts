import path from "node:path";
import { writeFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const si = vi.hoisted(() => ({ networkStats: vi.fn() }));
vi.mock("systeminformation", () => ({ default: si }));

import {
  createNetworkReader,
  parseDefaultIface,
  parseProcNetDev,
  parseSnmpTcp,
  parseWireless,
} from "../src/metrics/network.js";
import { cleanupFixtures, fixtureDir } from "./fixtures.js";

const NET_DEV_HEADER = `Inter-|   Receive                        |  Transmit
 face |bytes packets errs drop fifo frame compressed multicast|bytes packets errs drop fifo colls carrier compressed
`;

function netDev(rows: Record<string, [number, number]>): string {
  let content = NET_DEV_HEADER;
  for (const [iface, [rx, tx]] of Object.entries(rows)) {
    content += `${iface.padStart(6)}: ${rx} 10 0 0 0 0 0 0 ${tx} 8 0 0 0 0 0 0\n`;
  }
  return content;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(1_700_000_000_000);
});

afterEach(async () => {
  vi.useRealTimers();
  await cleanupFixtures();
});

describe("parseProcNetDev", () => {
  it("skips loopback, container veths, idle devices and malformed rows", () => {
    const content =
      netDev({ lo: [10, 10], eth0: [100, 200], veth1a2b: [5, 5], ifb0: [0, 0] }) +
      "  bad: nope\n" +
      "  : 1 2 3\n";
    expect(parseProcNetDev(content)).toEqual([
      {
        iface: "eth0",
        rxBytes: 100,
        txBytes: 200,
        rxPackets: 10,
        txPackets: 8,
        errors: 0,
        drops: 0,
      },
    ]);
  });

  it("sums errors and drops across both directions", () => {
    const content = `${NET_DEV_HEADER}  eth0: 100 10 3 4 0 0 0 0 200 8 1 2 0 0 0 0
  wlan0: 50 5 0 0 0 0 0 0 60 6
`;
    expect(parseProcNetDev(content)).toEqual([
      {
        iface: "eth0",
        rxBytes: 100,
        txBytes: 200,
        rxPackets: 10,
        txPackets: 8,
        errors: 4, // 3 received + 1 sent
        drops: 6, // 4 received + 2 sent
      },
      // a row cut short before the transmit counters still counts what it
      // did report
      {
        iface: "wlan0",
        rxBytes: 50,
        txBytes: 60,
        rxPackets: 5,
        txPackets: 6,
        errors: 0,
        drops: 0,
      },
    ]);
  });
});

describe("parseSnmpTcp", () => {
  const SNMP = `Ip: Forwarding DefaultTTL
Ip: 1 64
Tcp: RtoAlgorithm CurrEstab InSegs RetransSegs
Tcp: 1 20 8365 27
`;

  it("pairs the TCP header with its values", () => {
    expect(parseSnmpTcp(SNMP)).toEqual({ established: 20, retransSegs: 27 });
  });

  it("returns null when the columns it needs are missing", () => {
    expect(parseSnmpTcp("Tcp: RtoAlgorithm InSegs\nTcp: 1 8365\n")).toBeNull();
    expect(parseSnmpTcp("Udp: InDatagrams\nUdp: 3\n")).toBeNull();
    // a header with no value line under it, with and without a trailing
    // newline: the file was truncated mid-write
    expect(parseSnmpTcp("Tcp: CurrEstab RetransSegs\n")).toBeNull();
    expect(parseSnmpTcp("Tcp: CurrEstab RetransSegs")).toBeNull();
  });
});

describe("parseDefaultIface", () => {
  it("finds the interface carrying the default route", () => {
    const routes = `Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask
eth0\t0000A8C0\t00000000\t0001\t0\t0\t0\t00FFFFFF
wlan0\t00000000\t0100A8C0\t0003\t0\t0\t600\t00000000
`;
    expect(parseDefaultIface(routes)).toBe("wlan0");
    expect(parseDefaultIface("Iface\tDestination\n")).toBeNull();
  });
});

describe("parseWireless", () => {
  it("turns the driver's quality and level into percent and dBm", () => {
    const content = `Inter-| sta-|   Quality        |   Discarded packets
 face | tus | link level noise |  nwid  crypt   frag  retry   misc
 wlan0: 0000   63.  -47.  -256        0      0      0      0      0
`;
    expect(parseWireless(content)).toEqual({
      iface: "wlan0",
      quality: 90,
      signalDbm: -47,
    });
  });

  it("converts an unsigned level and caps the quality at 100%", () => {
    const content = `header
header
 wlan0: 0000   99.  209.  -256        0
`;
    expect(parseWireless(content)).toEqual({
      iface: "wlan0",
      quality: 100,
      signalDbm: -47,
    });
  });

  it("reports nulls for a driver that publishes neither, and null with no radio", () => {
    expect(parseWireless("h\nh\n wlan0: 0000   n/a  n/a\n")).toEqual({
      iface: "wlan0",
      quality: null,
      signalDbm: null,
    });
    // a line that stops after the status column
    expect(parseWireless("h\nh\n wlan0: 0000\n")).toEqual({
      iface: "wlan0",
      quality: null,
      signalDbm: null,
    });
    expect(parseWireless("header\nheader\n\n: 0 0\n")).toBeNull();
  });
});

describe("createNetworkReader", () => {
  async function reader(files: {
    dev?: string;
    route?: string;
    wireless?: string;
    snmp?: string;
    /** one directory per interface, as /sys/class/net publishes them */
    classNet?: Record<string, Record<string, string>>;
  }) {
    const root = await fixtureDir({
      dev: files.dev ?? "",
      ...(files.route === undefined ? {} : { route: files.route }),
      ...(files.wireless === undefined ? {} : { wireless: files.wireless }),
      ...(files.snmp === undefined ? {} : { snmp: files.snmp }),
      ...(files.classNet === undefined ? {} : { class: files.classNet }),
    });
    return {
      root,
      read: createNetworkReader({
        procNetDev: path.join(root, "dev"),
        procNetRoute: path.join(root, "route"),
        procNetSnmp: path.join(root, "snmp"),
        sysClassNet: path.join(root, "class"),
        wirelessPath: path.join(root, "wireless"),
      }),
    };
  }

  /** what every interface reports when nothing else is configured */
  const BARE = {
    rxPacketsSec: 0,
    txPacketsSec: 0,
    errors: 0,
    drops: 0,
    speedMbps: null,
    duplex: null,
  };

  it("reports zero on the first sample, then bytes per second", async () => {
    const { root, read } = await reader({
      dev: netDev({ eth0: [1000, 500] }),
      route: "Iface\tDestination\neth0\t00000000\n",
    });

    expect(await read()).toEqual({
      iface: "eth0",
      rxSec: 0,
      txSec: 0,
      interfaces: [
        { iface: "eth0", rxSec: 0, txSec: 0, rxBytes: 1000, txBytes: 500, ...BARE },
      ],
      wifi: null,
      tcp: null,
    });

    vi.setSystemTime(1_700_000_002_000); // two seconds later
    await writeFile(path.join(root, "dev"), netDev({ eth0: [3000, 900] }));
    const second = await read();
    expect(second.rxSec).toBe(1000);
    expect(second.txSec).toBe(200);
  });

  it("clamps a counter that went backwards", async () => {
    const { root, read } = await reader({ dev: netDev({ eth0: [5000, 5000] }) });
    await read();
    vi.setSystemTime(1_700_000_001_000);
    await writeFile(path.join(root, "dev"), netDev({ eth0: [10, 10] }));
    expect((await read()).rxSec).toBe(0);
  });

  it.each<[string, Record<string, [number, number]>, string]>([
    ["last", { eth0: [10, 10], wlan0: [9000, 40] }, "wlan0"],
    ["first", { eth0: [9000, 40], wlan0: [10, 10] }, "eth0"],
  ])(
    "headlines the busiest interface (%s) when there is no default route",
    async (_position, rows, expected) => {
      const { read } = await reader({ dev: netDev(rows) });
      const metrics = await read();
      expect(metrics.iface).toBe(expected);
      expect(metrics.interfaces).toHaveLength(2);
    },
  );

  it("attaches the wireless link when the radio is up", async () => {
    const { read } = await reader({
      dev: netDev({ wlan0: [1, 1] }),
      wireless: "h\nh\n wlan0: 0000   70.  -30.  -256\n",
    });
    expect((await read()).wifi).toEqual({
      iface: "wlan0",
      quality: 100,
      signalDbm: -30,
    });
  });

  it("reports nothing readable as an unknown interface", async () => {
    const { read } = await reader({ dev: NET_DEV_HEADER });
    expect(await read()).toEqual({
      iface: "unknown",
      rxSec: 0,
      txSec: 0,
      interfaces: [],
      wifi: null,
      tcp: null,
    });
  });

  it("falls back to systeminformation without procfs", async () => {
    si.networkStats.mockResolvedValue([
      { iface: "en0", rx_sec: 1234.6, tx_sec: -3, rx_bytes: 99, tx_bytes: null },
    ]);
    const read = createNetworkReader({ procNetDev: "/nonexistent/dev" });
    expect(await read()).toEqual({
      iface: "en0",
      rxSec: 1235,
      txSec: 0,
      interfaces: [
        { iface: "en0", rxSec: 1235, txSec: 0, rxBytes: 99, txBytes: 0, ...BARE },
      ],
      wifi: null,
      tcp: null,
    });

    si.networkStats.mockResolvedValue([
      { iface: "en0", rx_sec: null, tx_sec: null, rx_bytes: null, tx_bytes: 12 },
    ]);
    expect(await read()).toMatchObject({ rxSec: 0, txSec: 0 });

    si.networkStats.mockResolvedValue([]);
    expect(await read()).toEqual({
      iface: "unknown",
      rxSec: 0,
      txSec: 0,
      interfaces: [],
      wifi: null,
      tcp: null,
    });
  });

  it("counts errors and drops, and turns packets into a rate", async () => {
    const row = (rxBytes: number, rxPackets: number, txPackets: number) =>
      `${NET_DEV_HEADER}  eth0: ${rxBytes} ${rxPackets} 2 3 0 0 0 0 500 ${txPackets} 1 0 0 0 0 0\n`;
    const { root, read } = await reader({ dev: row(1000, 100, 40) });
    await read();

    vi.setSystemTime(1_700_000_002_000);
    await writeFile(path.join(root, "dev"), row(2000, 300, 140));
    const [primary] = (await read()).interfaces;
    expect(primary).toMatchObject({
      rxPacketsSec: 100, // 200 packets over 2 s
      txPacketsSec: 50,
      errors: 3, // counters, not rates: they are read as "since boot"
      drops: 3,
    });
  });

  it("reads the negotiated link once, and ignores a driver that shrugs", async () => {
    const { read } = await reader({
      dev: netDev({ eth0: [1, 1], wlan0: [1, 1] }),
      classNet: {
        eth0: { speed: "1000\n", duplex: "full\n" },
        // Wi-Fi doesn't negotiate: -1 and "unknown" are what the kernel gives
        wlan0: { speed: "-1\n", duplex: "unknown\n" },
      },
    });

    const byName = Object.fromEntries(
      (await read()).interfaces.map((entry) => [entry.iface, entry]),
    );
    expect(byName["eth0"]).toMatchObject({ speedMbps: 1000, duplex: "full" });
    expect(byName["wlan0"]).toMatchObject({ speedMbps: null, duplex: null });

    // the second tick is served from the cache: nothing is read again for
    // another 30 s, whatever the refresh rate
    vi.setSystemTime(1_700_000_000_500);
    expect((await read()).interfaces[0]).toMatchObject({ speedMbps: 1000 });
    vi.setSystemTime(1_700_000_060_000);
    expect((await read()).interfaces[0]).toMatchObject({ speedMbps: 1000 });
  });

  it("counts established connections and retransmissions per second", async () => {
    const snmp = (retrans: number) =>
      `Tcp: RtoAlgorithm CurrEstab RetransSegs\nTcp: 1 12 ${retrans}\n`;
    const { root, read } = await reader({
      dev: netDev({ eth0: [1, 1] }),
      snmp: snmp(100),
    });
    // first sample: a counter with nothing to compare against
    expect((await read()).tcp).toEqual({ established: 12, retransSegsSec: null });

    vi.setSystemTime(1_700_000_004_000);
    await writeFile(path.join(root, "snmp"), snmp(110));
    expect((await read()).tcp).toEqual({ established: 12, retransSegsSec: 2.5 });
  });

  it("leaves TCP null when /proc/net/snmp says nothing useful", async () => {
    const { read } = await reader({
      dev: netDev({ eth0: [1, 1] }),
      snmp: "Udp: InDatagrams\nUdp: 3\n",
    });
    expect((await read()).tcp).toBeNull();
  });

  it("reports zero when two samples land in the same millisecond", async () => {
    const { root, read } = await reader({ dev: netDev({ eth0: [1, 1] }) });
    await read();
    await writeFile(path.join(root, "dev"), netDev({ eth0: [9999, 9999] }));
    expect((await read()).rxSec).toBe(0);
  });
});
