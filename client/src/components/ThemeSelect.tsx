import { useI18n, type TranslationKey } from "../i18n";
import { THEME_CHOICES, useTheme, type ThemeChoice } from "../theme";

const LABELS: Record<ThemeChoice, TranslationKey> = {
  system: "theme.system",
  light: "theme.light",
  dark: "theme.dark",
};

export function ThemeSelect() {
  const { t } = useI18n();
  const { choice, setChoice } = useTheme();

  return (
    <label className="flex items-center gap-2 text-xs text-ink-faint">
      <span className="sr-only">{t("header.theme")}</span>
      <select
        value={choice}
        onChange={(event) => setChoice(event.target.value as ThemeChoice)}
        title={t("header.theme")}
        className="cursor-pointer rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink-soft outline-none hover:border-line-strong focus:border-line-strong"
      >
        {THEME_CHOICES.map((value) => (
          <option key={value} value={value}>
            {t(LABELS[value])}
          </option>
        ))}
      </select>
    </label>
  );
}
