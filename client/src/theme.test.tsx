import { act, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "./i18n";
import { ThemeProvider, useTheme } from "./theme";
import { ThemeSelect } from "./components/ThemeSelect";

const original = globalThis.matchMedia;

/** a MediaQueryList whose "matches" we can flip from the test */
function stubMatchMedia(matches: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  globalThis.matchMedia = ((media: string) => ({
    media,
    matches,
    addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) =>
      listeners.add(listener),
    removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) =>
      listeners.delete(listener),
  })) as unknown as typeof matchMedia;

  return (nowMatches: boolean) => {
    for (const listener of listeners) {
      listener({ matches: nowMatches } as MediaQueryListEvent);
    }
  };
}

afterEach(() => {
  globalThis.matchMedia = original;
  document.documentElement.removeAttribute("data-theme");
});

function renderTheme() {
  return renderHook(() => useTheme(), { wrapper: ThemeProvider });
}

describe("ThemeProvider", () => {
  it("follows the system preference by default", () => {
    stubMatchMedia(true);
    expect(renderTheme().result.current).toMatchObject({
      choice: "system",
      theme: "light",
    });
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("falls back to dark: the dashboard is a night-time tool", () => {
    stubMatchMedia(false);
    expect(renderTheme().result.current.theme).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("reacts to the system flipping while the page is open", () => {
    const emit = stubMatchMedia(false);
    const { result } = renderTheme();
    act(() => emit(true));
    expect(result.current.theme).toBe("light");
    act(() => emit(false));
    expect(result.current.theme).toBe("dark");
  });

  it("pins and persists an explicit choice", async () => {
    stubMatchMedia(false);
    const { result } = renderTheme();
    act(() => result.current.setChoice("light"));
    expect(result.current.theme).toBe("light");
    expect(localStorage.getItem("mopitor.theme")).toBe("light");

    // a fresh mount reads it back
    expect(renderTheme().result.current.choice).toBe("light");
  });

  it("ignores a stored value that isn't a theme", () => {
    stubMatchMedia(false);
    localStorage.setItem("mopitor.theme", "chartreuse");
    expect(renderTheme().result.current.choice).toBe("system");
  });

  it("still works when storage is unavailable", () => {
    stubMatchMedia(false);
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });

    const { result } = renderTheme();
    act(() => result.current.setChoice("dark"));
    expect(result.current.theme).toBe("dark");

    get.mockRestore();
    set.mockRestore();
  });

  it("falls back to dark without matchMedia", () => {
    globalThis.matchMedia = undefined as unknown as typeof matchMedia;
    expect(renderTheme().result.current.theme).toBe("dark");
  });

  it("reads a MediaQueryList that can't be subscribed to (Safari < 14)", () => {
    globalThis.matchMedia = (() => ({ matches: true })) as unknown as typeof matchMedia;
    // the first read still counts; only later system changes go unnoticed
    expect(renderTheme().result.current.theme).toBe("light");
  });
});

describe("useTheme", () => {
  it("refuses to run outside a provider", () => {
    expect(() => renderHook(() => useTheme())).toThrow(/ThemeProvider/);
  });
});

describe("ThemeSelect", () => {
  it("switches the interface to the chosen skin", async () => {
    stubMatchMedia(false);
    render(
      <I18nProvider>
        <ThemeProvider>
          <ThemeSelect />
        </ThemeProvider>
      </I18nProvider>,
    );

    await userEvent.selectOptions(screen.getByTitle("Theme"), "light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
