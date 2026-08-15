import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Bar, BigValue, Card, levelColor } from "./Card";
import { CpuCard } from "./CpuCard";
import { DiskCard } from "./DiskCard";
import { MemoryCard } from "./MemoryCard";
import { NetworkCard } from "./NetworkCard";
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
  it("says so when no sensor exists at all", () => {
    render(<TemperatureCard temperature={{ cpu: null }} fan={{ rpm: null }} />);
    expect(screen.getByText("No sensor available")).toBeInTheDocument();
  });

  it("shows the temperature with a normal subtitle", () => {
    render(<TemperatureCard temperature={{ cpu: 52.1 }} fan={{ rpm: null }} />);
    expect(screen.getByText("52.1°C")).toBeInTheDocument();
    expect(screen.getByText("CPU")).toBeInTheDocument();
  });

  it("warns near the throttle limit", () => {
    render(<TemperatureCard temperature={{ cpu: 80 }} fan={{ rpm: null }} />);
    expect(screen.getByText(/throttle limit/)).toBeInTheDocument();
  });

  it("shows the fan RPM alongside the temperature", () => {
    render(<TemperatureCard temperature={{ cpu: 50 }} fan={{ rpm: 3241 }} />);
    expect(screen.getByText("fan")).toBeInTheDocument();
    expect(screen.getByText(/3[,  .]?241 RPM/)).toBeInTheDocument();
  });

  it("handles a fan without a temperature sensor, including stopped", () => {
    render(<TemperatureCard temperature={{ cpu: null }} fan={{ rpm: 0 }} />);
    expect(screen.queryByText("No sensor available")).toBeNull();
    expect(screen.getByText("0 RPM")).toBeInTheDocument();
    expect(screen.getByText("(stopped)")).toBeInTheDocument();
  });
});

describe("DiskCard", () => {
  it("shows usage for the reported mount", () => {
    const gib = 1024 ** 3;
    render(<DiskCard disk={{ mount: "/host", total: 100 * gib, used: 30 * gib }} />);
    expect(screen.getByRole("heading", { name: "Disk (/host)" })).toBeInTheDocument();
    expect(screen.getByText("30.0 GB")).toBeInTheDocument();
    expect(screen.getByText("30%")).toBeInTheDocument();
  });
});

describe("NetworkCard", () => {
  it("shows both directions with the interface name", () => {
    render(<NetworkCard network={{ iface: "eth0", rxSec: 2048, txSec: 1024 }} />);
    expect(screen.getByRole("heading", { name: "Network (eth0)" })).toBeInTheDocument();
    expect(screen.getByText(/2\.0 KB\/s/)).toBeInTheDocument();
    expect(screen.getByText(/1\.0 KB\/s/)).toBeInTheDocument();
  });
});
