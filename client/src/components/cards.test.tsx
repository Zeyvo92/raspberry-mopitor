import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { enableDetails, renderWithI18n as render } from "../test-utils";
import { Bar, BigValue, Card, levelColor } from "./Card";
import { CpuCard } from "./CpuCard";
import { DiskCard } from "./DiskCard";
import { FilesystemsCard } from "./FilesystemsCard";
import { MemoryCard } from "./MemoryCard";
import { NetworkCard } from "./NetworkCard";
import { PowerCard } from "./PowerCard";
import { TemperatureCard } from "./TemperatureCard";

describe("Card primitives", () => {
  it("renders the title and children", () => {
    render(<Card title="CPU">content</Card>);
    expect(screen.getByRole("heading", { name: "CPU" })).toBeInTheDocument();
    expect(screen.getByText("content")).toBeInTheDocument();
  });

  it("maps values to threshold colors", () => {
    expect(levelColor(10, 60, 85)).toBe("bg-emerald-500");
    expect(levelColor(70, 60, 85)).toBe("bg-amber-500");
    expect(levelColor(90, 60, 85)).toBe("bg-red-500");
  });

  it("clamps the bar and shows an optional label", () => {
    const { container, rerender } = render(<Bar value={150} label="c0" />);
    expect(screen.getByText("c0")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(container.querySelector(".bg-red-500")).not.toBeNull();

    rerender(<Bar value={-5} />);
    expect(screen.getByText("0%")).toBeInTheDocument();
    expect(screen.queryByText("c0")).toBeNull();
  });

  it("renders BigValue with and without a subtitle", () => {
    const { rerender } = render(<BigValue sub="details">42%</BigValue>);
    expect(screen.getByText("details")).toBeInTheDocument();
    rerender(<BigValue>42%</BigValue>);
    expect(screen.queryByText("details")).toBeNull();
  });
});

describe("CpuCard", () => {
  const base = {
    load: 12.3,
    perCore: [10, 20],
    loadAvg: [1, 2, 3] as [number, number, number],
    breakdown: null,
    runQueue: null,
    blocked: null,
    ctxSwitchesSec: null,
  };

  it("shows global load, per-core bars and frequency", () => {
    render(<CpuCard cpu={{ ...base, freqGhz: 1.8 }} />);
    expect(screen.getByText("12.3%")).toBeInTheDocument();
    expect(screen.getByText("c0")).toBeInTheDocument();
    expect(screen.getByText("c1")).toBeInTheDocument();
    expect(screen.getByText(/1\.8 GHz/)).toBeInTheDocument();
  });

  it("omits the frequency when unknown", () => {
    render(<CpuCard cpu={{ ...base, freqGhz: null }} />);
    expect(screen.queryByText(/GHz/)).toBeNull();
  });
});

describe("MemoryCard", () => {
  const gib = 1024 ** 3;

  it("shows usage and hides swap when absent", () => {
    render(
      <MemoryCard
        memory={{
          total: 8 * gib,
          used: 2 * gib,
          available: 6 * gib,
          swapTotal: 0,
          swapUsed: 0,
          detail: null,
        }}
      />,
    );
    expect(screen.getByText("2.0 GB")).toBeInTheDocument();
    expect(screen.queryByText("swap")).toBeNull();
  });

  it("shows the swap bar when swap exists", () => {
    render(
      <MemoryCard
        memory={{
          total: 8 * gib,
          used: 2 * gib,
          available: 6 * gib,
          swapTotal: gib,
          swapUsed: gib / 2,
          detail: null,
        }}
      />,
    );
    expect(screen.getByText("swap")).toBeInTheDocument();
  });
});

describe("TemperatureCard", () => {
  it("says so when no sensor exists", () => {
    render(<TemperatureCard temperature={{ cpu: null, sensors: [] }} />);
    expect(screen.getByText("No sensor available")).toBeInTheDocument();
  });

  it("shows the temperature with a normal subtitle", () => {
    render(<TemperatureCard temperature={{ cpu: 52.1, sensors: [] }} />);
    expect(screen.getByText("52.1°C")).toBeInTheDocument();
    expect(screen.getByText("CPU")).toBeInTheDocument();
    expect(screen.queryByText("other probes")).not.toBeInTheDocument();
  });

  it("warns near the throttle limit", () => {
    render(<TemperatureCard temperature={{ cpu: 80, sensors: [] }} />);
    expect(screen.getByText(/throttle limit/)).toBeInTheDocument();
  });

  it("lists the probes the SoC sensor doesn't cover", () => {
    render(
      <TemperatureCard
        temperature={{ cpu: 52.1, sensors: [{ name: "nvme", celsius: 41.85 }] }}
      />,
    );
    expect(screen.getByText("other probes")).toBeInTheDocument();
    expect(screen.getByText("nvme")).toBeInTheDocument();
    expect(screen.getByText("41.9°C")).toBeInTheDocument();
  });
});

describe("DiskCard", () => {
  const gib = 1024 ** 3;
  const disk = {
    mount: "/host",
    total: 100 * gib,
    used: 30 * gib,
    inodesTotal: 0,
    inodesUsed: 0,
    readOnly: false,
    filesystems: [],
    io: null,
  };

  it("shows usage for the reported mount", () => {
    render(<DiskCard disk={disk} />);
    expect(screen.getByRole("heading", { name: "Disk (/host)" })).toBeInTheDocument();
    expect(screen.getByText("30.0 GB")).toBeInTheDocument();
    expect(screen.getByText("30%")).toBeInTheDocument();
    expect(screen.queryByText("read")).not.toBeInTheDocument();
  });

  it("adds throughput when the host reports it", () => {
    render(
      <DiskCard
        disk={{
          ...disk,
          io: {
            readSec: 2048,
            writeSec: 4096,
            iops: 0,
            awaitMs: null,
            utilPercent: 0,
            devices: [],
          },
        }}
      />,
    );
    expect(screen.getByText("read")).toBeInTheDocument();
    expect(screen.getByText(/2\.0 KB\/s/)).toBeInTheDocument();
    expect(screen.getByText(/4\.0 KB\/s/)).toBeInTheDocument();
  });
});

describe("FilesystemsCard", () => {
  it("lists every mount with its usage", () => {
    const gib = 1024 ** 3;
    render(
      <FilesystemsCard
        filesystems={[
          {
            mount: "/",
            type: "ext4",
            total: 100 * gib,
            used: 50 * gib,
            inodesTotal: 0,
            inodesUsed: 0,
            readOnly: false,
          },
          {
            mount: "/boot/firmware",
            type: "vfat",
            total: 512 * 1024 ** 2,
            used: 128 * 1024 ** 2,
            inodesTotal: 0,
            inodesUsed: 0,
            readOnly: false,
          },
        ]}
      />,
    );
    expect(screen.getByText("/")).toBeInTheDocument();
    expect(screen.getByText("/boot/firmware")).toBeInTheDocument();
    expect(screen.getByText("ext4")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByText("25%")).toBeInTheDocument();
  });
});

describe("NetworkCard", () => {
  /** an interface reporting nothing beyond its throughput */
  const LINK = {
    iface: "eth0",
    rxSec: 0,
    txSec: 0,
    rxBytes: 10,
    txBytes: 5,
    rxPacketsSec: 0,
    txPacketsSec: 0,
    errors: 0,
    drops: 0,
    speedMbps: null,
    duplex: null,
  };

  const network = {
    iface: "eth0",
    rxSec: 2048,
    txSec: 1024,
    interfaces: [],
    wifi: null,
    tcp: null,
  };

  it("shows both directions with the interface name", () => {
    render(<NetworkCard network={network} />);
    expect(screen.getByRole("heading", { name: "Network (eth0)" })).toBeInTheDocument();
    expect(screen.getByText(/2\.0 KB\/s/)).toBeInTheDocument();
    expect(screen.getByText(/1\.0 KB\/s/)).toBeInTheDocument();
    expect(screen.queryByText("interfaces")).not.toBeInTheDocument();
  });

  it("lists the other interfaces but not the headline one", () => {
    render(
      <NetworkCard
        network={{
          ...network,
          interfaces: [
            { ...LINK, iface: "eth0", rxSec: 2048, txSec: 1024 },
            { ...LINK, iface: "wlan0", rxSec: 512, txSec: 256 },
          ],
        }}
      />,
    );
    expect(screen.getByText("interfaces")).toBeInTheDocument();
    expect(screen.getByText("wlan0")).toBeInTheDocument();
    // the headline interface is already named in the card title
    expect(screen.queryByText("eth0")).not.toBeInTheDocument();
  });

  it.each([
    [70, "bg-emerald-500"],
    [45, "bg-amber-500"],
    [10, "bg-red-500"],
  ])("colours a %i%% wifi link accordingly", (quality, expected) => {
    const { container } = render(
      <NetworkCard
        network={{
          ...network,
          wifi: { iface: "wlan0", quality, signalDbm: -55 },
        }}
      />,
    );
    expect(screen.getByText("Wi-Fi (wlan0)")).toBeInTheDocument();
    expect(screen.getByText("-55 dBm · link " + quality + "%")).toBeInTheDocument();
    expect(container.querySelector(`.${expected}`)).not.toBeNull();
  });

  it("hides the bar when the driver reports no quality", () => {
    render(
      <NetworkCard
        network={{
          ...network,
          wifi: { iface: "wlan0", quality: null, signalDbm: null },
        }}
      />,
    );
    expect(screen.getByText("Wi-Fi (wlan0)")).toBeInTheDocument();
  });
});

describe("PowerCard", () => {
  const sensed = {
    watts: 7.65,
    source: "sensor" as const,
    rails: [
      { name: "EXT5V", watts: 6 },
      { name: "3v3_sys", watts: 1.65 },
    ],
  };

  const energy = {
    todayKwh: 0.12,
    weekKwh: 0.84,
    monthKwh: 3.6,
    totalKwh: 12.5,
    since: "2026-08-01",
    avgWatts: 5.1,
    pricePerKwh: null,
    currency: "€",
  };

  it("shows the total draw and ranks the rails", () => {
    render(<PowerCard power={sensed} energy={null} />);

    expect(screen.getByText("7.65 W")).toBeInTheDocument();
    expect(screen.getByText("across 2 rails")).toBeInTheDocument();
    expect(screen.getByText("EXT5V")).toBeInTheDocument();
    expect(screen.getByText("1.65 W")).toBeInTheDocument();
  });

  it("survives a sensor that reports a total but no rail", () => {
    render(<PowerCard power={{ watts: 0, source: "sensor", rails: [] }} energy={null} />);
    expect(screen.getByText("0.00 W")).toBeInTheDocument();
  });

  it("draws an empty bar for a rail sitting at zero", () => {
    const { container } = render(
      <PowerCard
        power={{ watts: 0, source: "sensor", rails: [{ name: "3v3_dac", watts: 0 }] }}
        energy={null}
      />,
    );
    expect(container.querySelector<HTMLElement>(".bg-emerald-500\\/70")?.style.width).toBe(
      "0%",
    );
  });

  it("marks a modelled draw as an estimate, and names the board", () => {
    render(
      <PowerCard
        power={{ watts: 4.6, source: "estimate", rails: [] }}
        energy={null}
        model="Raspberry Pi 4 Model B"
      />,
    );

    const value = screen.getByText("≈ 4.6 W");
    expect(value).toBeInTheDocument();
    expect(value).toHaveAttribute("title", expect.stringContaining("Raspberry Pi 4"));
    expect(screen.getByText(/estimated from the board/)).toBeInTheDocument();
  });

  it("falls back to the family name when the board is unknown", () => {
    render(<PowerCard power={{ watts: 2.5, source: "estimate", rails: [] }} energy={null} />);
    expect(screen.getByText("≈ 2.5 W")).toHaveAttribute(
      "title",
      expect.stringContaining("Raspberry Pi"),
    );
  });

  it("adds up the consumption over each window", () => {
    render(<PowerCard power={sensed} energy={energy} />);

    // under a kWh the counters read in watt-hours, which is where a Pi lives
    expect(screen.getByText("120 Wh")).toBeInTheDocument();
    expect(screen.getByText("840 Wh")).toBeInTheDocument();
    expect(screen.getByText("3.60 kWh")).toBeInTheDocument();
    expect(screen.getByText("12.5 kWh")).toBeInTheDocument();
    expect(screen.getByText("5.1 W on average")).toBeInTheDocument();
    expect(screen.getByText("since 01/08")).toBeInTheDocument();
  });

  it("prices each window when the server knows the tariff", () => {
    render(
      <PowerCard power={null} energy={{ ...energy, pricePerKwh: 0.25, currency: "$" }} />,
    );

    expect(screen.getByText(/0\.03 \$/)).toBeInTheDocument(); // 0.12 kWh × 0.25
    expect(screen.getByText(/3\.13 \$/)).toBeInTheDocument(); // 12.5 kWh × 0.25
    // no live reading at all: the counters stand on their own
    expect(screen.queryByText(/W$/)).not.toBeInTheDocument();
  });

  it("keeps big totals readable", () => {
    render(<PowerCard power={null} energy={{ ...energy, totalKwh: 1234.5 }} />);
    expect(screen.getByText("1235 kWh")).toBeInTheDocument();
  });
});

describe("detailed rows", () => {
  const gib = 1024 ** 3;

  describe("CpuCard", () => {
    const cpu = {
      load: 50,
      perCore: [50],
      freqGhz: null,
      loadAvg: [1, 1, 1] as [number, number, number],
      breakdown: { user: 20.5, system: 5, iowait: 24, irq: 0.5, steal: 0 },
      runQueue: 4,
      blocked: 2,
      ctxSwitchesSec: 1500,
    };

    it("keeps the split out of the way until it is asked for", () => {
      render(<CpuCard cpu={cpu} />);
      expect(screen.queryByText("iowait")).toBeNull();
    });

    it("splits the time and names what the scheduler is holding", () => {
      enableDetails();
      render(<CpuCard cpu={cpu} />);
      expect(screen.getByText("iowait")).toBeInTheDocument();
      expect(screen.getByText("24.0%")).toBeInTheDocument();
      // bare metal never has stolen time: a row of zeros helps nobody
      expect(screen.queryByText("steal")).toBeNull();
      expect(
        screen.getByText("4 runnable · 2 blocked on I/O · 1,500 ctx/s"),
      ).toBeInTheDocument();
    });

    it("shows stolen time when there is any", () => {
      enableDetails();
      render(<CpuCard cpu={{ ...cpu, breakdown: { ...cpu.breakdown, steal: 3 } }} />);
      expect(screen.getByText("steal")).toBeInTheDocument();
    });

    it("says nothing it cannot read", () => {
      enableDetails();
      render(
        <CpuCard
          cpu={{ ...cpu, breakdown: null, blocked: 0, ctxSwitchesSec: null }}
        />,
      );
      expect(screen.queryByText("iowait")).toBeNull();
      expect(screen.getByText("4 runnable")).toBeInTheDocument();
    });

    it("shows nothing at all on a host without /proc/stat", () => {
      enableDetails();
      render(
        <CpuCard
          cpu={{ ...cpu, breakdown: null, runQueue: null, blocked: null, ctxSwitchesSec: null }}
        />,
      );
      expect(screen.queryByText(/runnable/)).toBeNull();
    });
  });

  describe("MemoryCard", () => {
    const memory = {
      total: 8 * gib,
      used: 2 * gib,
      available: 6 * gib,
      swapTotal: gib,
      swapUsed: 0,
      detail: {
        cached: gib,
        buffers: 64 * 1024 ** 2,
        dirty: 1024 ** 2,
        writeback: 0,
        shared: 4 * 1024 ** 2,
        swapInSec: 2048,
        swapOutSec: 4096,
        oomKills: 0,
      },
    };

    it("names the cache and the swap traffic once details are on", () => {
      enableDetails();
      render(<MemoryCard memory={memory} />);
      expect(screen.getByText("cache")).toBeInTheDocument();
      expect(screen.getByText("swap ↓ 2.0 KB/s ↑ 4.0 KB/s")).toBeInTheDocument();
    });

    it("keeps quiet without them, and when there is no swap traffic to show", () => {
      render(<MemoryCard memory={memory} />);
      expect(screen.queryByText("cache")).toBeNull();

      enableDetails();
      const { unmount } = render(
        <MemoryCard
          memory={{ ...memory, detail: { ...memory.detail, swapInSec: null } }}
        />,
      );
      expect(screen.queryByText(/swap ↓/)).toBeNull();
      unmount();

      // a machine with no swap at all has nothing to say about swapping
      render(<MemoryCard memory={{ ...memory, swapTotal: 0 }} />);
      expect(screen.queryByText(/swap ↓/)).toBeNull();
    });

    it("reports processes killed out of memory whatever the settings", () => {
      render(
        <MemoryCard memory={{ ...memory, detail: { ...memory.detail, oomKills: 3 } }} />,
      );
      expect(screen.getByText(/3 process\(es\) killed out of memory/)).toBeInTheDocument();
    });

    it("has nothing to add on a host with no /proc/meminfo", () => {
      enableDetails();
      render(<MemoryCard memory={{ ...memory, detail: null }} />);
      expect(screen.queryByText("cache")).toBeNull();
    });
  });

  describe("DiskCard", () => {
    const disk = {
      mount: "/",
      total: 100 * gib,
      used: 30 * gib,
      inodesTotal: 1000,
      inodesUsed: 250,
      readOnly: false,
      filesystems: [],
      io: {
        readSec: 0,
        writeSec: 0,
        iops: 42,
        awaitMs: 8.5,
        utilPercent: 65,
        devices: [],
      },
    };

    it("adds latency, busy share and inodes to the detailed rows", () => {
      enableDetails();
      render(<DiskCard disk={disk} />);
      expect(screen.getByText("latency")).toBeInTheDocument();
      expect(screen.getByText("8.5 ms")).toBeInTheDocument();
      expect(screen.getByText("65%")).toBeInTheDocument();
      expect(screen.getByText("25%")).toBeInTheDocument(); // inodes
    });

    it("skips what the device doesn't report", () => {
      enableDetails();
      render(
        <DiskCard
          disk={{ ...disk, inodesTotal: 0, io: { ...disk.io, awaitMs: null } }}
        />,
      );
      expect(screen.queryByText("latency")).toBeNull();
      expect(screen.queryByText("inodes")).toBeNull();
      expect(screen.getByText("busy")).toBeInTheDocument();
    });

    it("has nothing to add without /proc/diskstats", () => {
      enableDetails();
      render(<DiskCard disk={{ ...disk, io: null, inodesTotal: 0 }} />);
      expect(screen.queryByText("busy")).toBeNull();
    });

    it("warns about a read-only mount whatever the settings", () => {
      render(<DiskCard disk={{ ...disk, readOnly: true }} />);
      expect(screen.getByText("⚠ mounted read-only")).toBeInTheDocument();
    });

    it("says nothing when the mount table is out of reach", () => {
      render(<DiskCard disk={{ ...disk, readOnly: null }} />);
      expect(screen.queryByText(/read-only/)).toBeNull();
    });
  });

  describe("FilesystemsCard", () => {
    const filesystems = [
      {
        mount: "/",
        type: "ext4",
        total: 100 * gib,
        used: 50 * gib,
        inodesTotal: 1000,
        inodesUsed: 100,
        readOnly: false,
      },
      {
        mount: "/boot",
        type: "vfat",
        total: gib,
        used: gib / 2,
        inodesTotal: 0,
        inodesUsed: 0,
        readOnly: true,
      },
    ];

    it("flags a read-only mount and hides inodes until they are asked for", () => {
      render(<FilesystemsCard filesystems={filesystems} />);
      expect(screen.getByText("⚠ mounted read-only")).toBeInTheDocument();
      expect(screen.queryByText(/inodes/)).toBeNull();
    });

    it("adds inodes for the filesystems that have any", () => {
      enableDetails();
      render(<FilesystemsCard filesystems={filesystems} />);
      // vfat has no inode table, so only the ext4 row gets a figure
      expect(screen.getAllByText(/% inodes/)).toHaveLength(1);
      expect(screen.getByText("10% inodes")).toBeInTheDocument();
    });
  });

  describe("NetworkCard", () => {
    const eth0 = {
      iface: "eth0",
      rxSec: 0,
      txSec: 0,
      rxBytes: 100,
      txBytes: 50,
      rxPacketsSec: 1200,
      txPacketsSec: 800,
      errors: 2,
      drops: 7,
      speedMbps: 1000,
      duplex: "full",
    };
    const network = {
      iface: "eth0",
      rxSec: 0,
      txSec: 0,
      interfaces: [eth0],
      wifi: null,
      tcp: { established: 12, retransSegsSec: 0.5 },
    };

    it("adds packet rates, errors, the link and TCP health", () => {
      enableDetails();
      render(<NetworkCard network={network} />);
      expect(screen.getByText("1,200 / 800 pkt/s")).toBeInTheDocument();
      expect(screen.getByText("2 errors · 7 drops")).toBeInTheDocument();
      expect(screen.getByText("1000 Mb/s full")).toBeInTheDocument();
      expect(screen.getByText("12 TCP established · 0.5 retrans/s")).toBeInTheDocument();
    });

    it("leaves out a link that doesn't negotiate and a counter with no rate yet", () => {
      enableDetails();
      render(
        <NetworkCard
          network={{
            ...network,
            interfaces: [{ ...eth0, speedMbps: null }],
            tcp: { established: 3, retransSegsSec: null },
          }}
        />,
      );
      expect(screen.queryByText(/Mb\/s/)).toBeNull();
      expect(screen.queryByText(/TCP established/)).toBeNull();
    });

    it("names the speed without a duplex the driver never reported", () => {
      enableDetails();
      render(
        <NetworkCard network={{ ...network, interfaces: [{ ...eth0, duplex: null }] }} />,
      );
      expect(screen.getByText("1000 Mb/s")).toBeInTheDocument();
    });

    it("adds nothing when there is nothing to add", () => {
      enableDetails();
      render(<NetworkCard network={{ ...network, interfaces: [], tcp: null }} />);
      expect(screen.queryByText(/pkt\/s/)).toBeNull();
    });
  });
});
