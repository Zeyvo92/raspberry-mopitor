import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ContainerTable } from "./ContainerTable";
import { renderWithI18n } from "../test-utils";
import type { ContainerInfo, ContainerList } from "../types";

const MB = 1024 * 1024;

const container = (over: Partial<ContainerInfo> = {}): ContainerInfo => ({
  id: "9f2c1b4a5e6d",
  name: "pihole",
  image: "pihole/pihole:latest",
  state: "running",
  cpuPercent: 1.4,
  memUsage: 120 * MB,
  memLimit: 512 * MB,
  netRxSec: 1024,
  netTxSec: 512,
  startedAt: 1_700_000_000_000,
  ...over,
});

const list = (...containers: ContainerInfo[]): ContainerList => ({
  ts: 1_700_000_360_000, // six minutes after the container started
  list: containers,
});

describe("ContainerTable", () => {
  it("shows the counts, the image and the live figures", () => {
    renderWithI18n(<ContainerTable containers={list(container())} />);

    expect(screen.getByText("1 running · 1 total")).toBeInTheDocument();
    expect(screen.getByText("pihole")).toBeInTheDocument();
    expect(screen.getByText("pihole/pihole:latest")).toBeInTheDocument();
    expect(screen.getByText("1.4%")).toBeInTheDocument();
    expect(screen.getByText("120 MB")).toBeInTheDocument();
    expect(screen.getByText("/ 512 MB")).toBeInTheDocument();
    expect(screen.getByText("↓ 1.0 KB/s")).toBeInTheDocument();
    expect(screen.getByText("6m")).toBeInTheDocument();
  });

  it("dashes out everything a stopped container cannot report", () => {
    renderWithI18n(
      <ContainerTable
        containers={list(
          container({
            state: "exited",
            cpuPercent: null,
            memUsage: null,
            memLimit: null,
            netRxSec: null,
            netTxSec: null,
            startedAt: 0,
          }),
        )}
      />,
    );
    const row = screen.getAllByRole("row")[1]!;
    expect(within(row).getAllByText("—")).toHaveLength(4);
    expect(screen.getByText("exited")).toBeInTheDocument();
    expect(screen.getByText("0 running · 1 total")).toBeInTheDocument();
  });

  it("marks a restarting container with the warning style, not just a word", () => {
    const { container: dom } = renderWithI18n(
      <ContainerTable containers={list(container({ state: "restarting" }))} />,
    );
    expect(dom.querySelector(".text-amber-400")).not.toBeNull();
  });

  it("styles a state it does not know like a stopped one", () => {
    const { container: dom } = renderWithI18n(
      <ContainerTable containers={list(container({ state: "created" }))} />,
    );
    expect(screen.getByText("created")).toBeInTheDocument();
    expect(dom.querySelector(".text-zinc-400")).not.toBeNull();
  });

  it("hides the uptime of a container that is not running", () => {
    renderWithI18n(
      <ContainerTable containers={list(container({ state: "paused" }))} />,
    );
    const row = screen.getAllByRole("row")[1]!;
    expect(within(row).getByText("—")).toBeInTheDocument();
  });

  it("waits for the first payload, then says the host has no container", () => {
    const { rerender } = renderWithI18n(<ContainerTable containers={null} />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();

    rerender(<ContainerTable containers={list()} />);
    expect(screen.getByText("No containers on this host.")).toBeInTheDocument();
  });
});
