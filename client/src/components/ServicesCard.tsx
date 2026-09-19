import { formatAge } from "../format";
import { useI18n, type TranslationKey } from "../i18n";
import type { ServiceHealth, ServiceStatus } from "../types";
import { Card, Notice } from "./Card";

const STATUS_STYLE: Record<ServiceStatus, string> = {
  ok: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  failed: "border-red-500/40 bg-red-500/10 text-red-400",
  unknown: "border-line bg-track/60 text-ink-faint",
};

const STATUS_LABEL: Record<ServiceStatus, TranslationKey> = {
  ok: "services.ok",
  failed: "services.failed",
  unknown: "services.unknown",
};

/**
 * How long ago the host wrote the file, in ms. Null when it never did, or
 * wrote something that isn't a date — both mean there is no age to show. A
 * host clock running ahead of the browser's would otherwise read as a
 * negative age, so it is clamped to "just now".
 */
export function reportAge(updatedAt: string | null, now: number): number | null {
  if (updatedAt === null) return null;
  const ts = Date.parse(updatedAt);
  return Number.isNaN(ts) ? null : Math.max(now - ts, 0);
}

/**
 * Services running on the host, each vouching for itself in a small JSON
 * file (see WATCHED_SERVICES). The card only exists when one is configured:
 * nothing here is discovered, every row was asked for by name.
 *
 * The age matters as much as the badge. A service that retries every few
 * seconds and last said "ok" an hour ago is not healthy — it is gone, and
 * the only trace of that is a timestamp that stopped moving.
 */
export function ServicesCard({
  services,
  now,
}: {
  services: ServiceHealth[];
  /** the snapshot's own clock, so every row ages with the live loop */
  now: number;
}) {
  const { t } = useI18n();

  return (
    <Card title={t("services.title")}>
      <ul className="space-y-3">
        {services.map((service) => {
          const age = reportAge(service.updatedAt, now);
          return (
            <li key={service.name}>
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="truncate text-ink">{service.name}</span>
                <span
                  className={`shrink-0 rounded-full border px-2 py-0.5 font-medium ${STATUS_STYLE[service.status]}`}
                >
                  {t(STATUS_LABEL[service.status])}
                </span>
              </div>
              <p className="mt-1 text-xs text-ink-faint">
                {age === null
                  ? t("services.never")
                  : t("services.updated", { age: formatAge(age) })}
              </p>
              {service.status === "failed" && service.message !== "" && (
                <Notice>{service.message}</Notice>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
