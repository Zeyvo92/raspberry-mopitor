import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useKiosk } from "./kiosk";

const requestFullscreen = vi.fn(() => Promise.resolve());
const exitFullscreen = vi.fn(() => Promise.resolve());

function setSearch(search: string) {
  window.history.replaceState({}, "", `/${search}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  setSearch("");
  document.documentElement.requestFullscreen =
    requestFullscreen as unknown as typeof document.documentElement.requestFullscreen;
  document.exitFullscreen = exitFullscreen as unknown as typeof document.exitFullscreen;
});

afterEach(() => {
  setSearch("");
  document.documentElement.removeAttribute("data-kiosk");
});

describe("useKiosk", () => {
  it("starts windowed and marks the document", () => {
    const { result } = renderHook(() => useKiosk());
    expect(result.current.kiosk).toBe(false);
    expect(document.documentElement.dataset.kiosk).toBe("false");
    expect(requestFullscreen).not.toHaveBeenCalled();
  });

  it("goes fullscreen on toggle and comes back out", () => {
    const { result } = renderHook(() => useKiosk());

    act(() => result.current.toggleKiosk());
    expect(result.current.kiosk).toBe(true);
    expect(document.documentElement.dataset.kiosk).toBe("true");
    expect(requestFullscreen).toHaveBeenCalledOnce();

    // the browser is fullscreen now: leaving must hand it back
    Object.defineProperty(document, "fullscreenElement", {
      value: document.documentElement,
      configurable: true,
    });
    act(() => result.current.toggleKiosk());
    expect(exitFullscreen).toHaveBeenCalledOnce();
    Object.defineProperty(document, "fullscreenElement", {
      value: null,
      configurable: true,
    });
  });

  it("leaves on Escape", () => {
    const { result } = renderHook(() => useKiosk());
    act(() => result.current.setKiosk(true));

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    });
    expect(result.current.kiosk).toBe(true);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(result.current.kiosk).toBe(false);
  });

  it("starts in kiosk mode from the URL", () => {
    setSearch("?kiosk=1");
    const { result } = renderHook(() => useKiosk());
    expect(result.current.kiosk).toBe(true);
  });

  it("shrugs off a browser that refuses fullscreen, either way", () => {
    requestFullscreen.mockRejectedValueOnce(new Error("denied"));
    exitFullscreen.mockRejectedValueOnce(new Error("denied"));
    const { result } = renderHook(() => useKiosk());

    act(() => result.current.setKiosk(true));
    expect(result.current.kiosk).toBe(true);

    Object.defineProperty(document, "fullscreenElement", {
      value: document.documentElement,
      configurable: true,
    });
    act(() => result.current.setKiosk(false));
    expect(result.current.kiosk).toBe(false);
    Object.defineProperty(document, "fullscreenElement", {
      value: null,
      configurable: true,
    });
  });

  it("works where the Fullscreen API is missing entirely", () => {
    // @ts-expect-error - exercising a browser without the API
    delete document.documentElement.requestFullscreen;
    // @ts-expect-error - same
    delete document.exitFullscreen;

    const { result } = renderHook(() => useKiosk());
    act(() => result.current.setKiosk(true));
    expect(document.documentElement.dataset.kiosk).toBe("true");

    Object.defineProperty(document, "fullscreenElement", {
      value: document.documentElement,
      configurable: true,
    });
    act(() => result.current.setKiosk(false));
    expect(document.documentElement.dataset.kiosk).toBe("false");
    Object.defineProperty(document, "fullscreenElement", {
      value: null,
      configurable: true,
    });
  });
});
