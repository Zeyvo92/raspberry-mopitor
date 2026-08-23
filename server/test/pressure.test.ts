import path from "node:path";
import { writeFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPressureReader, parsePressure } from "../src/metrics/pressure.js";
import { cleanupFixtures, fixtureDir } from "./fixtures.js";

const psi = (avg10: number) =>
  `some avg10=${avg10.toFixed(2)} avg60=0.31 avg300=0.12 total=12345678
full avg10=0.00 avg60=0.00 avg300=0.00 total=0
`;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_700_000_000_000);
});

afterEach(async () => {
  vi.useRealTimers();
  await cleanupFixtures();
});

describe("parsePressure", () => {
  it("reads the three windows off the 'some' line", () => {
    expect(parsePressure(psi(4.2))).toEqual({ avg10: 4.2, avg60: 0.31, avg300: 0.12 });
  });

  it("returns null when the line is missing or incomplete", () => {
    expect(parsePressure("full avg10=1.00 avg60=1.00 avg300=1.00 total=1\n")).toBeNull();
    expect(parsePressure("some avg10=1.00 total=1\n")).toBeNull();
    expect(parsePressure("some avg10=x avg60=1.00 avg300=1.00\n")).toBeNull();
  });
});

describe("createPressureReader", () => {
  it("reports each resource the kernel exposes", async () => {
    const root = await fixtureDir({
      cpu: psi(1.5),
      io: psi(12),
      memory: psi(0),
    });
    expect(await createPressureReader(root)()).toEqual({
      cpu: { avg10: 1.5, avg60: 0.31, avg300: 0.12 },
      io: { avg10: 12, avg60: 0.31, avg300: 0.12 },
      memory: { avg10: 0, avg60: 0.31, avg300: 0.12 },
    });
  });

  it("keeps the resources it can read and nulls the rest", async () => {
    const root = await fixtureDir({ io: psi(3) });
    expect(await createPressureReader(root)()).toEqual({
      cpu: null,
      io: { avg10: 3, avg60: 0.31, avg300: 0.12 },
      memory: null,
    });
  });

  it("reports nothing at all on a kernel built without PSI", async () => {
    expect(await createPressureReader("/nonexistent")()).toBeNull();
  });

  it("re-reads at most once a second, however fast the loop ticks", async () => {
    const root = await fixtureDir({ cpu: psi(1), io: psi(1), memory: psi(1) });
    const read = createPressureReader(root);
    expect((await read())?.cpu?.avg10).toBe(1);

    await writeFile(path.join(root, "cpu"), psi(9));
    vi.setSystemTime(1_700_000_000_500);
    expect((await read())?.cpu?.avg10).toBe(1); // still the cached reading

    vi.setSystemTime(1_700_000_001_500);
    expect((await read())?.cpu?.avg10).toBe(9);
  });
});
