import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FanCard } from "./FanCard";
import { Gauge } from "./Gauge";

const arcs = (container: HTMLElement) =>
  [...container.querySelectorAll("circle[stroke-dasharray]")] as SVGCircleElement[];
const filledLength = (container: HTMLElement) =>
  Number(arcs(container)[1]!.getAttribute("stroke-dasharray")!.split(" ")[0]);

describe("Gauge", () => {
  it("draws a track and a fill proportional to the value", () => {
    const { container } = render(<Gauge value={50} label="half" />);
    const [track, fill] = arcs(container);
    const trackLength = Number(track!.getAttribute("stroke-dasharray")!.split(" ")[0]);
    const fillLength = Number(fill!.getAttribute("stroke-dasharray")!.split(" ")[0]);
    expect(fillLength).toBeCloseTo(trackLength / 2, 5);
    expect(screen.getByRole("img", { name: "half" })).toBeInTheDocument();
  });

  it("clamps out-of-range values", () => {
    const { container: over } = render(<Gauge value={150} />);
    const { container: under } = render(<Gauge value={-20} />);
    const trackLength = Number(
      arcs(over)[0]!.getAttribute("stroke-dasharray")!.split(" ")[0],
    );
    expect(filledLength(over)).toBeCloseTo(trackLength, 5);
    expect(filledLength(under)).toBe(0);
  });

  it("renders children inside the ring", () => {
    render(<Gauge value={10}>centered</Gauge>);
    expect(screen.getByText("centered")).toBeInTheDocument();
  });
});

describe("FanCard", () => {
  it("shows the speed and its share of the scale", () => {
    render(<FanCard fan={{ rpm: 4000 }} />);
    expect(screen.getByText("4,000")).toBeInTheDocument();
    expect(screen.getByText("rpm")).toBeInTheDocument();
    // 4000 of the 8000 rpm nominal scale
    expect(screen.getByText("50% of 8,000 rpm")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Fan at 4000 RPM" })).toBeInTheDocument();
  });

  it("animates the blades at a speed that tracks the RPM", () => {
    const { container: slow } = render(<FanCard fan={{ rpm: 1000 }} />);
    const { container: fast } = render(<FanCard fan={{ rpm: 7000 }} />);
    const duration = (c: HTMLElement) =>
      Number.parseFloat(
        (c.querySelector("svg g[style]") as SVGGElement).style.animationDuration,
      );
    expect(duration(slow)).toBeGreaterThan(duration(fast));
  });

  it("reports a stopped fan without animating it", () => {
    const { container } = render(<FanCard fan={{ rpm: 0 }} />);
    expect(screen.getByText("stopped · below threshold")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Fan stopped" })).toBeInTheDocument();
    expect(container.querySelector("svg g[style]")).toBeNull();
    expect(filledLength(container)).toBe(0);
  });

  it("rescales when the fan spins past the nominal maximum", () => {
    render(<FanCard fan={{ rpm: 9000 }} />);
    expect(screen.getByText("100% of 9,000 rpm")).toBeInTheDocument();
  });

  it("treats a missing reading as stopped", () => {
    render(<FanCard fan={{ rpm: null }} />);
    expect(screen.getByText("0")).toBeInTheDocument();
  });
});
