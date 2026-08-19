import type { ReactNode } from "react";

export function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-muted">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** green under warn, amber under crit, red above */
export function levelColor(value: number, warn: number, crit: number): string {
  if (value >= crit) return "bg-red-500";
  if (value >= warn) return "bg-amber-500";
  return "bg-emerald-500";
}

export function Bar({
  value,
  warn = 60,
  crit = 85,
  label,
}: {
  /** percent 0-100 */
  value: number;
  warn?: number;
  crit?: number;
  label?: string;
}) {
  const clamped = Math.min(Math.max(value, 0), 100);
  return (
    <div className="flex items-center gap-2">
      {label !== undefined && (
        <span className="w-10 shrink-0 text-right font-mono text-xs text-ink-faint">
          {label}
        </span>
      )}
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-track">
        <div
          className={`h-full rounded-full transition-[width] duration-300 ${levelColor(clamped, warn, crit)}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className="w-12 shrink-0 text-right font-mono text-xs text-ink-soft">
        {clamped.toFixed(0)}%
      </span>
    </div>
  );
}

export function BigValue({ children, sub }: { children: ReactNode; sub?: string }) {
  return (
    <div className="mb-3">
      <div className="font-mono text-3xl font-bold text-ink">{children}</div>
      {sub && <div className="mt-1 text-xs text-ink-faint">{sub}</div>}
    </div>
  );
}
