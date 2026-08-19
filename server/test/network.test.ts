import path from "node:path";
import { writeFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const si = vi.hoisted(() => ({ networkStats: vi.fn() }));
vi.mock("systeminformation", () => ({ default: si }));

import {
  createNetworkReader,
  parseDefaultIface,
  parseProcNetDev,
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
      { iface: "eth0", rxBytes: 100, txBytes: 200 },
    ]);
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
  }) {
    const root = await fixtureDir({
      dev: files.dev ?? "",
      ...(files.route === undefined ? {} : { route: files.route }),
      ...(files.wireless === undefined ? {} : { wireless: files.wireless }),
    });
    return {
      root,
      read: createNetworkReader({
        procNetDev: path.join(root, "dev"),
        procNetRoute: path.join(root, "route"),
        wirelessPath: path.join(root, "wireless"),
      }),
    };
  }

  it("reports zero on the first sample, then bytes per second", async () => {
    const { root, read } = await reader({
      dev: netDev({ eth0: [1000, 500] }),
      route: "Iface\tDestination\neth0\t00000000\n",
    });

    expect(await read()).toEqual({
      iface: "eth0",
      rxSec: 0,
      txSec: 0,
      interfaces: [{ iface: "eth0", rxSec: 0, txSec: 0, rxBytes: 1000, txBytes: 500 }],
      wifi: null,
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
        { iface: "en0", rxSec: 1235, txSec: 0, rxBytes: 99, txBytes: 0 },
      ],
      wifi: null,
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
    });
  });

  it("reports zero when two samples land in the same millisecond", async () => {
    const { root, read } = await reader({ dev: netDev({ eth0: [1, 1] }) });
    await read();
    await writeFile(path.join(root, "dev"), netDev({ eth0: [9999, 9999] }));
    expect((await read()).rxSec).toBe(0);
  });
});
