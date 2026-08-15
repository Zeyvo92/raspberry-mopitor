import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { formatInterval, RefreshControl } from "./RefreshControl";

const config = { refreshIntervalMs: 1000, minIntervalMs: 100, maxIntervalMs: 60000 };

describe("formatInterval", () => {
  it("uses ms below a second, seconds above", () => {
    expect(formatInterval(100)).toBe("100ms");
    expect(formatInterval(1000)).toBe("1s");
    expect(formatInterval(1500)).toBe("1.5s");
    expect(formatInterval(10000)).toBe("10s");
  });
});

describe("RefreshControl", () => {
  it("renders the presets with the current value selected", () => {
    render(<RefreshControl config={config} onChange={() => {}} />);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("1000");
    const labels = [...select.options].map((o) => o.textContent);
    expect(labels).toEqual(["100ms", "200ms", "500ms", "1s", "2s", "5s", "10s"]);
  });

  it("keeps a non-preset current value selectable, in order", () => {
    render(
      <RefreshControl config={{ ...config, refreshIntervalMs: 1500 }} onChange={() => {}} />,
    );
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("1500");
    const labels = [...select.options].map((o) => o.textContent);
    expect(labels.indexOf("1.5s")).toBe(labels.indexOf("1s") + 1);
  });

  it("filters presets outside the server bounds", () => {
    render(
      <RefreshControl
        config={{ refreshIntervalMs: 1000, minIntervalMs: 500, maxIntervalMs: 5000 }}
        onChange={() => {}}
      />,
    );
    const labels = [...(screen.getByRole("combobox") as HTMLSelectElement).options].map(
      (o) => o.textContent,
    );
    expect(labels).toEqual(["500ms", "1s", "2s", "5s"]);
  });

  it("reports changes as numbers", () => {
    const onChange = vi.fn();
    render(<RefreshControl config={config} onChange={onChange} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "200" } });
    expect(onChange).toHaveBeenCalledWith(200);
  });
});
