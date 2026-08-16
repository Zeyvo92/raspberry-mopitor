import { render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider, LANGS, useI18n } from ".";
import { en } from "./en";
import { fr } from "./fr";
import { LanguageSelect } from "../components/LanguageSelect";

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <I18nProvider>{children}</I18nProvider>
);

const renderI18n = () => renderHook(() => useI18n(), { wrapper });

afterEach(() => vi.unstubAllGlobals());

describe("dictionaries", () => {
  it("translate the same keys in every language", () => {
    expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort());
  });

  it("keep the placeholders of the source string", () => {
    const placeholders = (value: string) => (value.match(/\{\w+\}/g) ?? []).sort();
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(placeholders(fr[key]), key).toEqual(placeholders(en[key]));
    }
  });

  it("offer exactly the languages the picker lists", () => {
    expect(LANGS).toEqual(["en", "fr"]);
  });
});

describe("useI18n", () => {
  it("follows the browser language when nothing was chosen", () => {
    vi.stubGlobal("navigator", { language: "fr-CA" });
    expect(renderI18n().result.current.lang).toBe("fr");
  });

  it("falls back to English for a language it does not speak", () => {
    vi.stubGlobal("navigator", { language: "de-DE" });
    expect(renderI18n().result.current.lang).toBe("en");
  });

  it("remembers a previous choice over the browser preference", () => {
    localStorage.setItem("mopitor.lang", "fr");
    vi.stubGlobal("navigator", { language: "en-GB" });
    expect(renderI18n().result.current.lang).toBe("fr");
  });

  it("ignores a corrupted stored choice", () => {
    localStorage.setItem("mopitor.lang", "klingon");
    vi.stubGlobal("navigator", { language: "en-GB" });
    expect(renderI18n().result.current.lang).toBe("en");
  });

  it("interpolates values and leaves unknown placeholders alone", () => {
    const { result } = renderI18n();
    expect(result.current.t("header.updateAvailable", { version: "9.9.9" })).toBe(
      "v9.9.9 available",
    );
    expect(result.current.t("header.updateAvailable")).toBe("v{version} available");
    expect(result.current.t("header.updateAvailable", { other: 1 })).toBe(
      "v{version} available",
    );
  });

  it("refuses to work outside the provider rather than rendering blank labels", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useI18n())).toThrow(/inside <I18nProvider>/);
    error.mockRestore();
  });

  it("survives a browser that refuses storage", () => {
    const getItem = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("denied");
      });
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("denied");
      });
    vi.stubGlobal("navigator", { language: "fr" });

    render(
      <I18nProvider>
        <LanguageSelect />
      </I18nProvider>,
    );
    expect(screen.getByRole("combobox")).toHaveValue("fr");

    getItem.mockRestore();
    setItem.mockRestore();
  });
});

describe("LanguageSelect", () => {
  it("switches the interface and persists the choice", async () => {
    vi.stubGlobal("navigator", { language: "en-GB" });
    render(
      <I18nProvider>
        <LanguageSelect />
      </I18nProvider>,
    );

    await userEvent.selectOptions(screen.getByRole("combobox"), "fr");
    expect(screen.getByRole("combobox")).toHaveValue("fr");
    expect(localStorage.getItem("mopitor.lang")).toBe("fr");
    expect(document.documentElement.lang).toBe("fr");
  });
});
