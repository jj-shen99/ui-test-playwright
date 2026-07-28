/**
 * Unit tests for live-log helpers (#16): normalizeLevel, formatElapsed,
 * elapsedMs, filterLogs.
 *
 * Techniques: equivalence partitioning (level classes), boundary values
 * (0/59.9/60s formatting), decision table (enabled-set membership), and edge
 * cases (unparseable/out-of-order timestamps, empty filter set).
 */

import { describe, it, expect } from "vitest";
import {
  normalizeLevel,
  formatElapsed,
  elapsedMs,
  filterLogs,
  LOG_LEVELS,
  type LogLineLike,
} from "../../frontend/src/logFormat";

describe("normalizeLevel", () => {
  it("passes through known levels", () => {
    expect(normalizeLevel("stderr")).toBe("stderr");
    expect(normalizeLevel("system")).toBe("system");
    expect(normalizeLevel("stdout")).toBe("stdout");
  });
  it("maps anything unknown to stdout", () => {
    expect(normalizeLevel("")).toBe("stdout");
    expect(normalizeLevel("weird")).toBe("stdout");
  });
});

describe("formatElapsed", () => {
  it("formats sub-minute values with one decimal second", () => {
    expect(formatElapsed(0)).toBe("0.0s");
    expect(formatElapsed(1500)).toBe("1.5s");
    expect(formatElapsed(59900)).toBe("59.9s");
  });
  it("formats minute+ values as m:ss (boundary at 60s)", () => {
    expect(formatElapsed(60000)).toBe("1:00");
    expect(formatElapsed(90000)).toBe("1:30");
    expect(formatElapsed(605000)).toBe("10:05");
  });
  it("clamps negative / NaN to 0", () => {
    expect(formatElapsed(-100)).toBe("0.0s");
    expect(formatElapsed(NaN)).toBe("0.0s");
  });
});

describe("elapsedMs", () => {
  const base = "2025-01-01T00:00:00.000Z";
  it("computes the delta from the baseline", () => {
    expect(elapsedMs("2025-01-01T00:00:02.500Z", base)).toBe(2500);
  });
  it("returns 0 when no baseline is given", () => {
    expect(elapsedMs(base, undefined)).toBe(0);
  });
  it("returns 0 for unparseable timestamps", () => {
    expect(elapsedMs("nonsense", base)).toBe(0);
    expect(elapsedMs(base, "nonsense")).toBe(0);
  });
  it("never returns a negative value (out-of-order lines)", () => {
    expect(elapsedMs(base, "2025-01-01T00:00:05.000Z")).toBe(0);
  });
});

describe("filterLogs", () => {
  const logs: LogLineLike[] = [
    { seq: 1, stream: "stdout", message: "a", createdAt: "" },
    { seq: 2, stream: "stderr", message: "b", createdAt: "" },
    { seq: 3, stream: "system", message: "c", createdAt: "" },
    { seq: 4, stream: "mystery", message: "d", createdAt: "" }, // → stdout
  ];

  it("keeps only enabled levels", () => {
    const out = filterLogs(logs, new Set(["stderr"] as const));
    expect(out.map((l) => l.seq)).toEqual([2]);
  });

  it("treats unknown streams as stdout", () => {
    const out = filterLogs(logs, ["stdout"]);
    expect(out.map((l) => l.seq)).toEqual([1, 4]);
  });

  it("returns everything when all levels are enabled", () => {
    expect(filterLogs(logs, LOG_LEVELS)).toHaveLength(4);
  });

  it("returns nothing when the enabled-set is empty", () => {
    expect(filterLogs(logs, new Set())).toEqual([]);
  });
});
