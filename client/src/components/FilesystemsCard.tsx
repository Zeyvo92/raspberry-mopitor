import { formatBytes, percent } from "../format";
import { useI18n } from "../i18n";
import { useDisplay } from "../settings";
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
  const { advanced } = useDisplay();

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
            <Footnotes filesystem={filesystem} inodes={advanced} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

/**
 * Under a filesystem's bar: whether the kernel has remounted it read-only —
 * a failing SD card's only warning, so never hidden — and how full its inode
 * table is, which is a detail until the day it is the whole problem.
 */
function Footnotes({
  filesystem,
  inodes,
}: {
  filesystem: FilesystemMetrics;
  inodes: boolean;
}) {
  const { t } = useI18n();
  const readOnly = filesystem.readOnly === true;
  // vfat has no inode table and reports zero
  const showInodes = inodes && filesystem.inodesTotal > 0;
  if (!readOnly && !showInodes) return null;

  return (
    <div className="mt-0.5 flex justify-between gap-2 text-xs">
      <span className="text-red-400">{readOnly && t("disk.readOnly")}</span>
      {showInodes && (
        <span className="shrink-0 font-mono text-ink-ghost">
          {t("filesystems.inodes", {
            percent: percent(filesystem.inodesUsed, filesystem.inodesTotal).toFixed(0),
          })}
        </span>
      )}
    </div>
  );
}
