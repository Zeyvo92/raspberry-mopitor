import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ProcessTable } from "./ProcessTable";
import { renderWithI18n } from "../test-utils";
import type { ProcessInfo, ProcessList } from "../types";

const MB = 1024 * 1024;

const proc = (over: Partial<ProcessInfo>): ProcessInfo => ({
  pid: 1,
  name: "node",
  cpu: 1,
  memPercent: 1,
  memBytes: MB,
  user: "pi",
  command: "node dist/server.js",
  ...over,
});

const list: ProcessList = {
  ts: 1,
  total: 118,
  running: 2,
  sleeping: 116,
  list: [
    proc({ pid: 10, name: "busy", cpu: 90, memBytes: MB }),
    proc({ pid: 20, name: "hungry", cpu: 1, memBytes: 800 * MB, memPercent: 40 }),
  ],
};

const rowNames = () =>
  screen
    .getAllByRole("row")
    .slice(1) // skip the header
    .map((row) => within(row).getAllByRole("cell")[0]?.textContent);

describe("ProcessTable", () => {
  it("summarises the host and lists the processes, CPU first", () => {
    renderWithI18n(<ProcessTable processes={list} />);
    expect(
      screen.getByText("118 processes · 2 running · 116 sleeping"),
    ).toBeInTheDocument();
    expect(rowNames()?.[0]).toContain("busy");
  });

  it("re-sorts by memory without asking the server again", async () => {
    renderWithI18n(<ProcessTable processes={list} />);
    await userEvent.click(screen.getByRole("button", { name: "Memory" }));

    expect(rowNames()?.[0]).toContain("hungry");
    expect(screen.getByRole("button", { name: "Memory" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("scales the in-cell bars against the busiest row", () => {
    const { container } = renderWithI18n(<ProcessTable processes={list} />);
    const gauges = [...container.querySelectorAll("td[style]")].map((cell) =>
      cell.getAttribute("style"),
    );
    expect(gauges.some((style) => style?.includes("100%"))).toBe(true);
  });

  it("shows both the size and the share of memory", () => {
    renderWithI18n(<ProcessTable processes={list} />);
    expect(screen.getByText("800 MB")).toBeInTheDocument();
    expect(screen.getByText("40.0%")).toBeInTheDocument();
  });

  it("waits for the first payload without breaking the layout", () => {
    renderWithI18n(<ProcessTable processes={null} />);
    expect(screen.getByText("No process data yet.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("survives a process with no command line", () => {
    renderWithI18n(
      <ProcessTable
        processes={{ ...list, list: [proc({ pid: 30, name: "kthread", command: "" })] }}
      />,
    );
    expect(screen.getByText("kthread")).toBeInTheDocument();
  });

  it("keeps a table with zero usage from dividing by zero", () => {
    const { container } = renderWithI18n(
      <ProcessTable
        processes={{ ...list, list: [proc({ pid: 40, cpu: 0, memBytes: 0 })] }}
      />,
    );
    expect(container.querySelector("td[style]")?.getAttribute("style")).toContain("0%");
  });

  it("filters on the name, the user and the command line", async () => {
    renderWithI18n(<ProcessTable processes={list} />);
    const filter = screen.getByRole("searchbox", { name: "Filter processes" });

    await userEvent.type(filter, "hungry");
    expect(rowNames()).toHaveLength(1);
    expect(rowNames()?.[0]).toContain("hungry");

    await userEvent.clear(filter);
    await userEvent.type(filter, "  PI  ");
    expect(rowNames()).toHaveLength(2); // both run as "pi", case ignored

    await userEvent.clear(filter);
    await userEvent.type(filter, "dist/server.js");
    expect(rowNames()).toHaveLength(2);

    await userEvent.clear(filter);
    await userEvent.type(filter, "nothing here");
    expect(screen.getByText("No process matches this filter.")).toBeInTheDocument();
  });

  it("draws a CPU trend once a process has been seen twice", () => {
    const { rerender } = renderWithI18n(<ProcessTable processes={list} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();

    // the same payload again is the same sample, not a second one
    rerender(<ProcessTable processes={list} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();

    rerender(
      <ProcessTable
        processes={{
          ...list,
          ts: 2,
          list: [
            proc({ pid: 10, name: "busy", cpu: 40, memBytes: MB }),
            proc({ pid: 20, name: "hungry", cpu: 0, memBytes: 800 * MB }),
          ],
        }}
      />,
    );

    const trends = screen.getAllByRole("img");
    expect(trends).toHaveLength(2);
    expect(trends[0]).toHaveAccessibleName("busy — recent CPU usage");
    expect(trends[0]?.querySelector("polyline")).toHaveAttribute(
      "points",
      "0.0,2.0 100.0,10.9",
    );
  });

  it("forgets a process that exited", () => {
    const { rerender } = renderWithI18n(<ProcessTable processes={list} />);
    rerender(
      <ProcessTable
        processes={{ ...list, ts: 2, list: [proc({ pid: 10, name: "busy", cpu: 5 })] }}
      />,
    );
    rerender(
      <ProcessTable
        processes={{ ...list, ts: 3, list: [proc({ pid: 20, name: "hungry", cpu: 5 })] }}
      />,
    );
    // pid 20 came back with no history of its own: nothing to draw yet
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
