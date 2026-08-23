import { useEffect, useRef, useState } from "react";
import { useI18n, type TranslationKey } from "../i18n";
import { useDisplay, type CardId } from "../settings";

const CARD_LABELS: Record<CardId, TranslationKey> = {
  cpu: "display.card.cpu",
  memory: "display.card.memory",
  temperature: "display.card.temperature",
  fan: "display.card.fan",
  power: "display.card.power",
  disk: "display.card.disk",
  filesystems: "display.card.filesystems",
  network: "display.card.network",
  pressure: "display.card.pressure",
  throttle: "display.card.throttle",
};

/**
 * The ⚙ menu: which cards this browser shows, and whether they show their
 * detailed rows. Only the cards this machine can actually fill are listed —
 * offering to hide a fan that doesn't exist would be noise of its own.
 */
export function DisplaySettings({ available }: { available: readonly CardId[] }) {
  const { t } = useI18n();
  const { shows, toggle, advanced, setAdvanced, reset, hiddenCount } = useDisplay();
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    // No positioning context of its own: the menu below anchors to the header
    // (see SystemHeader), which is the only element here that always spans the
    // full content width.
    <div ref={container}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        title={t("display.title")}
        aria-label={t("display.title")}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink-soft hover:border-line-strong"
      >
        <span aria-hidden>⚙</span>
        {/* a reader who hid something should be able to tell at a glance */}
        {hiddenCount > 0 && (
          <span className="ml-1 font-mono text-ink-faint">{hiddenCount}</span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t("display.title")}
          className={
            // Anchored to the header's right edge rather than to the ⚙
            // itself: on a narrow screen the controls wrap and the button can
            // end up anywhere along the row, which would hang a menu pinned to
            // it off the side of the screen. The header always ends where the
            // content does. The last two rules keep it inside a very narrow or
            // a very short viewport.
            "absolute right-0 top-full z-20 mt-2 w-64 rounded-xl border " +
            "border-line bg-surface p-3 shadow-lg " +
            "max-h-[70vh] max-w-[calc(100vw-2rem)] overflow-y-auto"
          }
        >
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-muted">
            {t("display.cards")}
          </p>
          <ul className="space-y-1">
            {available.map((card) => (
              <li key={card}>
                <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-soft">
                  <input
                    type="checkbox"
                    checked={shows(card)}
                    onChange={() => toggle(card)}
                    className="accent-emerald-500"
                  />
                  {t(CARD_LABELS[card])}
                </label>
              </li>
            ))}
          </ul>

          <div className="mt-3 border-t border-line pt-3">
            <label className="flex cursor-pointer items-start gap-2 text-xs text-ink-soft">
              <input
                type="checkbox"
                checked={advanced}
                onChange={(event) => setAdvanced(event.target.checked)}
                className="mt-0.5 accent-emerald-500"
              />
              <span>
                {t("display.advanced")}
                <span className="mt-0.5 block text-ink-ghost">
                  {t("display.advancedHint")}
                </span>
              </span>
            </label>
          </div>

          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={reset}
              className="mt-3 w-full rounded-md border border-line px-2 py-1 text-xs text-ink-muted hover:border-line-strong hover:text-ink"
            >
              {t("display.showAll")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
