import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithI18n as render } from "../test-utils";
import { reportAge, ServicesCard } from "./ServicesCard";
import type { ServiceHealth } from "../types";

const NOW = Date.parse("2026-09-19T12:00:00Z");

const service = (over: Partial<ServiceHealth> = {}): ServiceHealth => ({
  name: "claude-rc",
  status: "ok",
  message: "",
  updatedAt: "2026-09-19T11:30:00Z",
  ...over,
});

describe("reportAge", () => {
  it("measures the report against the snapshot's clock", () => {
    expect(reportAge("2026-09-19T11:30:00Z", NOW)).toBe(30 * 60 * 1000);
  });

  it("has no age for a file that was never written, or holds junk", () => {
    expect(reportAge(null, NOW)).toBeNull();
    expect(reportAge("yesterday", NOW)).toBeNull();
  });

  it("clamps a host clock running ahead of the browser's", () => {
    expect(reportAge("2026-09-19T12:05:00Z", NOW)).toBe(0);
  });
});

describe("ServicesCard", () => {
  it("shows a healthy service with the age of its report", () => {
    render(<ServicesCard services={[service()]} now={NOW} />);
    expect(screen.getByText("claude-rc")).toBeInTheDocument();
    expect(screen.getByText("ok")).toBeInTheDocument();
    expect(screen.getByText("reported 30m ago")).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("says 'just now' rather than '0m' for a report seconds old", () => {
    render(
      <ServicesCard
        services={[service({ updatedAt: "2026-09-19T11:59:40Z" })]}
        now={NOW}
      />,
    );
    expect(screen.getByText("reported <1m ago")).toBeInTheDocument();
  });

  it("shows why a failed service failed", () => {
    render(
      <ServicesCard
        services={[service({ status: "failed", message: "OAuth token expired" })]}
        now={NOW}
      />,
    );
    expect(screen.getByText("failed")).toBeInTheDocument();
    // the reason is an anomaly: it shows whatever the display settings say
    expect(screen.getByRole("status")).toHaveTextContent("OAuth token expired");
  });

  it("keeps the badge alone when a failure came with no message", () => {
    render(<ServicesCard services={[service({ status: "failed" })]} now={NOW} />);
    expect(screen.getByText("failed")).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("reports a service that never wrote its file", () => {
    render(
      <ServicesCard
        services={[service({ status: "unknown", updatedAt: null })]}
        now={NOW}
      />,
    );
    expect(screen.getByText("unknown")).toBeInTheDocument();
    expect(screen.getByText("no report yet")).toBeInTheDocument();
  });

  it("lists every watched service", () => {
    render(
      <ServicesCard
        services={[service(), service({ name: "backup", status: "unknown" })]}
        now={NOW}
      />,
    );
    expect(screen.getByText("claude-rc")).toBeInTheDocument();
    expect(screen.getByText("backup")).toBeInTheDocument();
  });
});
