import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { MetricsSnapshot } from "./types";

/**
 * What the dashboard shows, decided per browser.
 *
 * The monitor keeps growing metrics, and a wall of cards is worse than a
 * short one: everyone watches a different handful. Two knobs cover it — hide
 * whole cards, and hide the second layer of numbers inside the ones you
 * keep. Both live in localStorage, so a Pi driving a kiosk screen and the
 * phone in your pocket can show different things.
 */
export type CardId =
  | "cpu"
  | "memory"
  | "temperature"
  | "fan"
  | "power"
  | "disk"
  | "filesystems"
  | "network"
  | "pressure"
  | "throttle";

/** display order of the grid; the panel lists them the same way */
export const CARD_IDS: readonly CardId[] = [
  "cpu",
  "memory",
  "temperature",
  "fan",
  "power",
  "disk",
  "filesystems",
  "network",
  "pressure",
  "throttle",
];

const STORAGE_KEY = "mopitor.display";

interface Stored {
  hidden: CardId[];
  advanced: boolean;
}

const DEFAULTS: Stored = { hidden: [], advanced: false };

function isCardId(value: unknown): value is CardId {
  return CARD_IDS.includes(value as CardId);
}

function storedSettings(): Stored {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<Stored>;
    return {
      // unknown ids are dropped rather than kept: a card renamed by an
      // upgrade must not stay invisible forever
      hidden: Array.isArray(parsed.hidden) ? parsed.hidden.filter(isCardId) : [],
      advanced: parsed.advanced === true,
    };
  } catch {
    // private mode, or a value written by a future version
    return DEFAULTS;
  }
}

/**
 * Which cards this machine has anything to say about. A Pi without a fan
 * tachometer shouldn't offer a Fan toggle, so availability is decided by the
 * data, once, and both the grid and the settings panel read it.
 */
export function availableCards(metrics: MetricsSnapshot): CardId[] {
  const has: Record<CardId, boolean> = {
    cpu: true,
    memory: true,
    temperature: true,
    fan: metrics.fan.rpm !== null,
    power: metrics.power !== null || metrics.energy !== null,
    disk: true,
    // one filesystem is already the headline card's subject
    filesystems: metrics.disk.filesystems.length > 1,
    network: true,
    pressure: metrics.pressure !== null,
    throttle: metrics.throttle !== null,
  };
  return CARD_IDS.filter((id) => has[id]);
}

export interface DisplayApi {
  /** false for a card the reader has hidden */
  shows: (card: CardId) => boolean;
  toggle: (card: CardId) => void;
  /** second layer of numbers inside the cards (iowait, inodes, drops…) */
  advanced: boolean;
  setAdvanced: (on: boolean) => void;
  /** back to every card visible */
  reset: () => void;
  hiddenCount: number;
}

const DisplayContext = createContext<DisplayApi | null>(null);

export function DisplayProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Stored>(storedSettings);

  const update = useCallback((next: Stored) => {
    setSettings(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // not persisting is fine, the choice still applies to this session
    }
  }, []);

  const value = useMemo<DisplayApi>(
    () => ({
      shows: (card) => !settings.hidden.includes(card),
      toggle: (card) =>
        update({
          ...settings,
          hidden: settings.hidden.includes(card)
            ? settings.hidden.filter((id) => id !== card)
            : [...settings.hidden, card],
        }),
      advanced: settings.advanced,
      setAdvanced: (on) => update({ ...settings, advanced: on }),
      reset: () => update({ ...settings, hidden: [] }),
      hiddenCount: settings.hidden.length,
    }),
    [settings, update],
  );

  return <DisplayContext.Provider value={value}>{children}</DisplayContext.Provider>;
}

export function useDisplay(): DisplayApi {
  const context = useContext(DisplayContext);
  if (!context) throw new Error("useDisplay must be used inside <DisplayProvider>");
  return context;
}
