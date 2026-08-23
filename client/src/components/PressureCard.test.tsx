import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { enableDetails, renderWithI18n as render } from "../test-utils";
import { PressureCard } from "./PressureCard";

const stall = (avg10: number) => ({ avg10, avg60: 2.5, avg300: 1.25 });

describe("PressureCard", () => {
  it("shows one bar per resource the kernel measures", () => {
    render(
      <PressureCard
        pressure={{ cpu: stall(1.2), io: stall(42), memory: stall(0) }}
      />,
    );
    expect(screen.getByRole("heading", { name: "Pressure (PSI)" })).toBeInTheDocument();
    expect(screen.getByText("CPU")).toBeInTheDocument();
    expect(screen.getByText("I/O")).toBeInTheDocument();
    expect(screen.getByText("RAM")).toBeInTheDocument();
    // a third of the time stalled on I/O is well past the warning threshold
    expect(screen.getByText("42%")).toBeInTheDocument();
  });

  it("leaves out a resource the kernel doesn't report", () => {
    render(<PressureCard pressure={{ cpu: null, io: stall(3), memory: null }} />);
    expect(screen.queryByText("CPU")).toBeNull();
    expect(screen.getByText("I/O")).toBeInTheDocument();
  });

  it("adds the longer windows only with the detailed rows on", () => {
    const pressure = { cpu: stall(1), io: null, memory: null };
    const { unmount } = render(<PressureCard pressure={pressure} />);
    expect(screen.queryByText(/60 s/)).toBeNull();
    unmount();

    enableDetails();
    render(<PressureCard pressure={pressure} />);
    expect(screen.getByText("60 s 2.5% · 300 s 1.3%")).toBeInTheDocument();
  });
});
