import { formatBytes, percent } from "../format";
import { useI18n } from "../i18n";
import type { FilesystemMetrics } from "../types";
import { Bar, Card } from "./Card";

/**
 * Every mounted filesystem, not just the one the headline card watches: a
 * full /boot/firmware or a full USB disk breaks a Pi just as thoroughly as a
 * full root does.
 */
export function FilesystemsCard({
  filesystems,
}: {
  filesystems: readonly FilesystemMetrics[];
}) {
  const { t } = useI18n();

  return (
    <Card title={t("filesystems.title")}>
      <ul className="space-y-2.5">
        {filesystems.map((filesystem) => (
          <li key={filesystem.mount}>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
              <span className="truncate font-mono text-ink-soft" title={filesystem.mount}>
                {filesystem.mount}
              </span>
              <span className="shrink-0 text-ink-faint">
                {formatBytes(filesystem.used)} / {formatBytes(filesystem.total)}
                <span className="ml-1.5 uppercase">{filesystem.type}</span>
              </span>
            </div>
            <Bar value={percent(filesystem.used, filesystem.total)} warn={75} crit={90} />
          </li>
        ))}
      </ul>
    </Card>
  );
}
