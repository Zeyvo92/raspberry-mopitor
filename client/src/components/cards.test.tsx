import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithI18n as render } from "../test-utils";
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
  const base = { load: 12.3, perCore: [10, 20], loadAvg: [1, 2, 3] as [number, number, number] };

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
        memory={{ total: 8 * gib, used: 2 * gib, available: 6 * gib, swapTotal: 0, swapUsed: 0 }}
      />,
    );
    expect(screen.getByText("2.0 GB")).toBeInTheDocument();
    expect(screen.queryByText("swap")).toBeNull();
  });

  it("shows the swap bar when swap exists", () => {
    render(
      <MemoryCard
        memory={{ total: 8 * gib, used: 2 * gib, available: 6 * gib, swapTotal: gib, swapUsed: gib / 2 }}
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
    render(<DiskCard disk={{ ...disk, io: { readSec: 2048, writeSec: 4096 } }} />);
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
          { mount: "/", type: "ext4", total: 100 * gib, used: 50 * gib },
          { mount: "/boot/firmware", type: "vfat", total: 512 * 1024 ** 2, used: 128 * 1024 ** 2 },
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
  const network = {
    iface: "eth0",
    rxSec: 2048,
    txSec: 1024,
    interfaces: [],
    wifi: null,
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
            { iface: "eth0", rxSec: 2048, txSec: 1024, rxBytes: 10, txBytes: 5 },
            { iface: "wlan0", rxSec: 512, txSec: 256, rxBytes: 4, txBytes: 2 },
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
  it("shows the total draw and ranks the rails", () => {
    render(
      <PowerCard
        power={{
          watts: 7.65,
          rails: [
            { name: "EXT5V", watts: 6 },
            { name: "3v3_sys", watts: 1.65 },
          ],
        }}
      />,
    );

    expect(screen.getByText("7.65 W")).toBeInTheDocument();
    expect(screen.getByText("across 2 rails")).toBeInTheDocument();
    expect(screen.getByText("EXT5V")).toBeInTheDocument();
    expect(screen.getByText("1.65 W")).toBeInTheDocument();
  });

  it("survives a sensor that reports a total but no rail", () => {
    render(<PowerCard power={{ watts: 0, rails: [] }} />);
    expect(screen.getByText("0.00 W")).toBeInTheDocument();
  });

  it("draws an empty bar for a rail sitting at zero", () => {
    const { container } = render(
      <PowerCard power={{ watts: 0, rails: [{ name: "3v3_dac", watts: 0 }] }} />,
    );
    expect(container.querySelector<HTMLElement>(".bg-emerald-500\\/70")?.style.width).toBe(
      "0%",
    );
  });
});
