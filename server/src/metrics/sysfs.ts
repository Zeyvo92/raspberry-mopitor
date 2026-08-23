import { promises as fs } from "node:fs";

/**
 * sysfs reading helpers shared by the hardware collectors. Every file here is
 * one short line the kernel renders on demand; anything unreadable (masked in
 * the container, device unplugged, driver absent) reads as "unknown" rather
 * than as an error — a missing probe must never take the monitor down.
 */
export async function readText(file: string): Promise<string | null> {
  try {
    const value = (await fs.readFile(file, "utf8")).trim();
    return value || null;
  } catch {
    return null;
  }
}

export async function readNumber(file: string): Promise<number | null> {
  const raw = await readText(file);
  if (raw === null) return null;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : null;
}

/** entries of a sysfs directory, empty when it doesn't exist */
export async function listDir(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir);
  } catch {
    return [];
  }
}

/**
 * Caches an async reading for `ms`.
 *
 * The live loop can tick ten times a second, but pressure averages, memory
 * breakdowns and TCP counters move far slower than that — re-reading them on
 * every tick would triple the monitor's syscall load to show the same number
 * again. Concurrent callers share the in-flight read.
 */
export function throttled<T>(ms: number, read: () => Promise<T>): () => Promise<T> {
  let cached: { value: T; at: number } | null = null;
  let pending: Promise<T> | null = null;

  return async () => {
    if (pending) return pending;
    if (cached && Date.now() - cached.at < ms) return cached.value;
    pending = read();
    try {
      const value = await pending;
      cached = { value, at: Date.now() };
      return value;
    } finally {
      pending = null;
    }
  };
}
