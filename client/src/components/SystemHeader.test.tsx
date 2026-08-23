import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  governor: "ondemand",
  cpuMaxGhz: 2.4,
  storage: { device: "mmcblk0", name: "SC32G", lifeUsedPercent: 20, preEol: "normal" },
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
        kiosk={false}
        cards={[]}
        onChangeInterval={() => {}}
        onToggleKiosk={() => {}}
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
        kiosk={false}
        cards={[]}
        onChangeInterval={() => {}}
        onToggleKiosk={() => {}}
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
        kiosk={false}
        cards={[]}
        onChangeInterval={() => {}}
        onToggleKiosk={() => {}}
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
        kiosk={false}
        cards={[]}
        onChangeInterval={() => {}}
        onToggleKiosk={() => {}}
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
        kiosk={false}
        cards={[]}
        onChangeInterval={onChangeInterval}
        onToggleKiosk={() => {}}
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
        kiosk={false}
        cards={[]}
        onChangeInterval={() => {}}
        onToggleKiosk={() => {}}
      />,
    );
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("names the boot device and how worn it is", () => {
    render(
      <SystemHeader
        info={info}
        config={config}
        uptime={null}
        connected={true}
        kiosk={false}
        cards={[]}
        onChangeInterval={() => {}}
        onToggleKiosk={() => {}}
      />,
    );
    expect(
      screen.getByText(/SC32G · 20% of write life used/),
    ).toBeInTheDocument();
  });

  it("names a drive that reports no wear estimate, and says nothing without one", () => {
    const { rerender } = render(
      <SystemHeader
        info={{
          ...info,
          storage: {
            device: "nvme0n1",
            name: null,
            lifeUsedPercent: null,
            preEol: null,
          },
        }}
        config={config}
        uptime={null}
        connected={true}
        kiosk={false}
        cards={[]}
        onChangeInterval={() => {}}
        onToggleKiosk={() => {}}
      />,
    );
    expect(screen.getByText(/nvme0n1/)).toBeInTheDocument();
    expect(screen.queryByText(/write life/)).not.toBeInTheDocument();

    rerender(
      <SystemHeader
        info={{ ...info, storage: null }}
        config={config}
        uptime={null}
        connected={true}
        kiosk={false}
        cards={[]}
        onChangeInterval={() => {}}
        onToggleKiosk={() => {}}
      />,
    );
    expect(screen.queryByText(/SC32G/)).not.toBeInTheDocument();
  });

  it("hands the kiosk toggle back to the app", async () => {
    const onToggleKiosk = vi.fn();
    render(
      <SystemHeader
        info={info}
        config={config}
        uptime={null}
        connected={true}
        kiosk={false}
        cards={[]}
        onChangeInterval={() => {}}
        onToggleKiosk={onToggleKiosk}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Kiosk mode" }));
    expect(onToggleKiosk).toHaveBeenCalledOnce();
  });

  it("strips itself down to a way out in kiosk mode", () => {
    render(
      <SystemHeader
        info={{
          ...info,
          app: {
            version: "1.0.0",
            latestVersion: "1.1.0",
            updateAvailable: true,
            releaseUrl: "https://example.test/release",
          },
        }}
        config={config}
        uptime={3600}
        connected={true}
        kiosk={true}
        cards={[]}
        onChangeInterval={() => {}}
        onToggleKiosk={() => {}}
      />,
    );

    expect(screen.getByRole("button", { name: "Leave kiosk mode" })).toBeInTheDocument();
    expect(screen.queryByTitle("Theme")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Language")).not.toBeInTheDocument();
    expect(screen.queryByText(/Raspberry Pi OS/)).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    // the hostname, the connection dot and the uptime survive
    expect(screen.getByText("raspberry")).toBeInTheDocument();
    expect(screen.getByText("1h 0m")).toBeInTheDocument();
  });
});

describe("SystemHeader display settings", () => {
  const props = {
    config,
    uptime: null,
    connected: true,
    onChangeInterval: () => {},
    onToggleKiosk: () => {},
  };

  it("offers the ⚙ menu once the machine has said what it can show", () => {
    const { rerender } = render(
      <SystemHeader info={info} kiosk={false} cards={[]} {...props} />,
    );
    // nothing has arrived yet: there is nothing to configure
    expect(screen.queryByRole("button", { name: "Display" })).toBeNull();

    rerender(<SystemHeader info={info} kiosk={false} cards={["cpu"]} {...props} />);
    expect(screen.getByRole("button", { name: "Display" })).toBeInTheDocument();
  });

  it("drops the menu in kiosk mode, like every other control", () => {
    render(<SystemHeader info={info} kiosk cards={["cpu"]} {...props} />);
    expect(screen.queryByRole("button", { name: "Display" })).toBeNull();
  });

  it("badges a card the controller says is wearing out", () => {
    const { rerender } = render(
      <SystemHeader
        info={{ ...info, storage: { ...info.storage!, preEol: "warning" } }}
        kiosk={false}
        cards={[]}
        {...props}
      />,
    );
    expect(screen.getByText("⚠ card wear warning")).toBeInTheDocument();

    rerender(
      <SystemHeader
        info={{ ...info, storage: { ...info.storage!, preEol: "urgent" } }}
        kiosk={false}
        cards={[]}
        {...props}
      />,
    );
    expect(screen.getByText("⚠ card at end of life")).toBeInTheDocument();
  });

  it("says nothing about a healthy card", () => {
    render(<SystemHeader info={info} kiosk={false} cards={[]} {...props} />);
    expect(screen.queryByText(/card wear/)).toBeNull();
  });
});
