import { LANG_LABELS, LANGS, useI18n, type Lang } from "../i18n";

export function LanguageSelect() {
  const { lang, setLang, t } = useI18n();

  return (
    <label className="flex items-center gap-2 text-xs text-ink-faint">
      <span className="sr-only">{t("header.language")}</span>
      <select
        value={lang}
        onChange={(event) => setLang(event.target.value as Lang)}
        title={t("header.language")}
        className="cursor-pointer rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink-soft outline-none hover:border-line-strong focus:border-line-strong"
      >
        {LANGS.map((code) => (
          <option key={code} value={code}>
            {LANG_LABELS[code]}
          </option>
        ))}
      </select>
    </label>
  );
}
