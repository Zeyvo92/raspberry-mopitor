import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithI18n as render } from "../test-utils";
import type { ThrottleMetrics } from "../types";
import { ThrottleAlert } from "./ThrottleAlert";
import { ThrottleCard } from "./ThrottleCard";

const CLEAR = {
  underVoltage: false,
  freqCapped: false,
  throttled: false,
  softTempLimit: false,
};

const throttle = (over: Partial<ThrottleMetrics> = {}): ThrottleMetrics => ({
  raw: 0,
  now: CLEAR,
  sinceBoot: CLEAR,
  ...over,
});

describe("ThrottleCard", () => {
  it("says the board is healthy when every flag is clear", () => {
    render(<ThrottleCard throttle={throttle()} />);
    expect(screen.getByText("Nothing reported since boot")).toBeInTheDocument();
    expect(screen.getAllByText("clear")).toHaveLength(4);
  });

  it("separates what is happening now from what happened since boot", () => {
    render(
      <ThrottleCard
        throttle={throttle({
          raw: 0x50001,
          now: { ...CLEAR, underVoltage: true },
          sinceBoot: { ...CLEAR, underVoltage: true, throttled: true },
        })}
      />,
    );

    expect(screen.getByText("now")).toBeInTheDocument();
    expect(screen.getByText("since boot")).toBeInTheDocument();
    expect(screen.getAllByText("clear")).toHaveLength(2);
    // the advice replaces the all-clear line as soon as anything is flagged
    expect(screen.getByText(/power supply is sagging/)).toBeInTheDocument();
  });
});

describe("ThrottleAlert", () => {
  it("draws nothing on hardware without the register, or on a healthy board", () => {
    const { container, rerender } = render(<ThrottleAlert throttle={null} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<ThrottleAlert throttle={throttle()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shouts about a live condition", () => {
    render(
      <ThrottleAlert
        throttle={throttle({
          now: { ...CLEAR, underVoltage: true, throttled: true },
          sinceBoot: { ...CLEAR, underVoltage: true, throttled: true },
        })}
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Under-voltage · Throttled — right now");
  });

  it("keeps a past condition visible, more quietly", () => {
    render(
      <ThrottleAlert
        throttle={throttle({ sinceBoot: { ...CLEAR, freqCapped: true } })}
      />,
    );

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Frequency capped — happened since boot",
    );
  });
});
