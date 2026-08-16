import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CONFIG, renderWithI18n as render } from "../test-utils";
import type { StaticInfo } from "../types";
import { SystemHeader } from "./SystemHeader";

const info: StaticInfo = {
  app: {
    version: "1.0.0",
    latestVersion: null,
    updateAvailable: false,
    releaseUrl: null,
  },
  features: { history: true, processes: true, containers: false },
  hostname: "raspberry",
  model: "Raspberry Pi 5 Model B Rev 1.0",
  os: "Raspberry Pi OS Lite (bookworm)",
  kernel: "6.6.0",
  arch: "arm64",
  cpuModel: "ARM Cortex-A76",
  cores: 4,
};

const config = CONFIG;

describe("SystemHeader", () => {
  it("falls back to the app name before static info arrives", () => {
    render(
      <SystemHeader
        info={null}
        config={null}
        uptime={null}
        connected={false}
        onChangeInterval={() => {}}
      />,
    );
    expect(screen.getByText("raspberry-mopitor")).toBeInTheDocument();
    expect(screen.getByTitle(/disconnected/)).toBeInTheDocument();
    // no config yet, so no refresh control — but the language picker never
    // depends on the connection
    expect(screen.queryByTitle(/Sampling interval/)).toBeNull();
    expect(screen.getByTitle("Language")).toBeInTheDocument();
    expect(screen.queryByText(/^up$/)).toBeNull();
  });

  it("shows hostname, version, system details, uptime and refresh control", () => {
    render(
      <SystemHeader
        info={info}
        config={config}
        uptime={90061}
        connected={true}
        onChangeInterval={() => {}}
      />,
    );
    expect(screen.getByText("raspberry")).toBeInTheDocument();
    expect(screen.getByTitle("connected")).toBeInTheDocument();
    expect(
      screen.getByText(/v1\.0\.0 · Raspberry Pi 5 Model B Rev 1\.0/),
    ).toBeInTheDocument();
    expect(screen.getByText("1d 1h 1m")).toBeInTheDocument();
    expect(screen.getByTitle(/Sampling interval/)).toBeInTheDocument();
    expect(screen.getByTitle("Language")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull(); // up to date -> no badge
  });

  it("shows the update badge linking to the release when behind", () => {
    render(
      <SystemHeader
        info={{
          ...info,
          app: {
            version: "1.0.0",
            latestVersion: "2.0.0",
            updateAvailable: true,
            releaseUrl: "https://github.com/x/releases/tag/v2.0.0",
          },
        }}
        config={config}
        uptime={null}
        connected={true}
        onChangeInterval={() => {}}
      />,
    );
    const badge = screen.getByRole("link", { name: /v2\.0\.0 available/ });
    expect(badge).toHaveAttribute("href", "https://github.com/x/releases/tag/v2.0.0");
  });

  it("degrades the badge link when the release URL is unknown", () => {
    render(
      <SystemHeader
        info={{
          ...info,
          app: {
            version: "1.0.0",
            latestVersion: "2.0.0",
            updateAvailable: true,
            releaseUrl: null,
          },
        }}
        config={null}
        uptime={null}
        connected={true}
        onChangeInterval={() => {}}
      />,
    );
    expect(screen.getByRole("link")).toHaveAttribute("href", "#");
  });

  it("wires the refresh control through", () => {
    const onChangeInterval = vi.fn();
    render(
      <SystemHeader
        info={info}
        config={config}
        uptime={null}
        connected={true}
        onChangeInterval={onChangeInterval}
      />,
    );
    const select = screen.getByTitle(/Sampling interval/);
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onChangeInterval).toHaveBeenCalled();
  });
});

describe("SystemHeader update badge", () => {
  it("says nothing when the server claims an update without naming it", () => {
    render(
      <SystemHeader
        info={{
          ...info,
          app: { ...info.app, updateAvailable: true, latestVersion: null },
        }}
        config={config}
        uptime={null}
        connected={true}
        onChangeInterval={() => {}}
      />,
    );
    expect(screen.queryByRole("link")).toBeNull();
  });
});
