import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import {
  availableCards,
  CARD_IDS,
  DisplayProvider,
  useDisplay,
} from "./settings";
import { SNAPSHOT } from "./test-utils";

const wrapper = ({ children }: { children: ReactNode }) => (
  <DisplayProvider>{children}</DisplayProvider>
);

const renderDisplay = () => renderHook(() => useDisplay(), { wrapper });

describe("DisplayProvider", () => {
  it("shows every card and hides the detailed rows by default", () => {
    const { result } = renderDisplay();
    expect(CARD_IDS.every((card) => result.current.shows(card))).toBe(true);
    expect(result.current.advanced).toBe(false);
    expect(result.current.hiddenCount).toBe(0);
  });

  it("remembers what was hidden, and brings it all back", () => {
    const { result } = renderDisplay();

    act(() => result.current.toggle("network"));
    expect(result.current.shows("network")).toBe(false);
    expect(result.current.hiddenCount).toBe(1);
    expect(localStorage.getItem("mopitor.display")).toContain("network");

    // the same card again puts it back
    act(() => result.current.toggle("network"));
    expect(result.current.shows("network")).toBe(true);

    act(() => result.current.toggle("disk"));
    act(() => result.current.toggle("fan"));
    act(() => result.current.reset());
    expect(result.current.hiddenCount).toBe(0);
  });

  it("keeps the detailed rows setting", () => {
    const { result } = renderDisplay();
    act(() => result.current.setAdvanced(true));
    expect(result.current.advanced).toBe(true);
    expect(renderDisplay().result.current.advanced).toBe(true);
  });

  it("reads back what a previous session stored, and drops what it can't use", () => {
    localStorage.setItem(
      "mopitor.display",
      JSON.stringify({ hidden: ["fan", "renamed-card"], advanced: true }),
    );
    const { result } = renderDisplay();
    expect(result.current.shows("fan")).toBe(false);
    // a card renamed by an upgrade must not stay invisible forever
    expect(result.current.hiddenCount).toBe(1);
    expect(result.current.advanced).toBe(true);
  });

  it("survives junk, a foreign shape and storage being unavailable", () => {
    localStorage.setItem("mopitor.display", "not json");
    expect(renderDisplay().result.current.hiddenCount).toBe(0);

    localStorage.setItem("mopitor.display", JSON.stringify({ hidden: "all" }));
    expect(renderDisplay().result.current.hiddenCount).toBe(0);

    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("private mode");
      });
    const { result } = renderDisplay();
    act(() => result.current.toggle("cpu"));
    // the choice still applies to this session, it just isn't persisted
    expect(result.current.shows("cpu")).toBe(false);
    setItem.mockRestore();
  });
});

describe("availableCards", () => {
  it("offers only what this machine can fill", () => {
    expect(availableCards(SNAPSHOT)).toEqual([
      "cpu",
      "memory",
      "temperature",
      "disk",
      "network",
    ]);
  });

  it("adds the hardware-dependent cards when the data is there", () => {
    expect(
      availableCards({
        ...SNAPSHOT,
        fan: { rpm: 3000 },
        power: { watts: 4, source: "sensor", rails: [] },
        pressure: { cpu: null, io: { avg10: 1, avg60: 1, avg300: 1 }, memory: null },
        throttle: {
          raw: 0,
          now: {
            underVoltage: false,
            freqCapped: false,
            throttled: false,
            softTempLimit: false,
          },
          sinceBoot: {
            underVoltage: false,
            freqCapped: false,
            throttled: false,
            softTempLimit: false,
          },
        },
        disk: {
          ...SNAPSHOT.disk,
          filesystems: [
            {
              mount: "/",
              type: "ext4",
              total: 1,
              used: 1,
              inodesTotal: 0,
              inodesUsed: 0,
              readOnly: false,
            },
            {
              mount: "/boot",
              type: "vfat",
              total: 1,
              used: 1,
              inodesTotal: 0,
              inodesUsed: 0,
              readOnly: false,
            },
          ],
        },
      }),
    ).toEqual(CARD_IDS);
  });

  it("counts a machine that only reports energy as having a power card", () => {
    const energy = {
      ...SNAPSHOT,
      energy: {
        todayKwh: 0.1,
        weekKwh: 1,
        monthKwh: 4,
        totalKwh: 10,
        since: "2026-01-01",
        avgWatts: 5,
        pricePerKwh: null,
        currency: "€",
      },
    };
    expect(availableCards(energy)).toContain("power");
  });
});

describe("useDisplay", () => {
  it("refuses to run outside a provider", () => {
    expect(() => renderHook(() => useDisplay())).toThrow(/DisplayProvider/);
  });
});
