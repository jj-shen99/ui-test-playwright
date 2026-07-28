/**
 * Pure helpers for the live console log panel (#16 log-streaming polish):
 * per-line elapsed timing and stream-level filtering.
 */

export interface LogLineLike {
  seq: number;
  stream: string;
  message: string;
  createdAt: string;
}

/** The stream levels we let users toggle. Anything unknown maps to 'stdout'. */
export const LOG_LEVELS = ["stdout", "stderr", "system"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** Normalize an arbitrary stream string to one of the known levels. */
export function normalizeLevel(stream: string): LogLevel {
  return stream === "stderr" || stream === "system" ? stream : "stdout";
}

/**
 * Format elapsed milliseconds as a compact `m:ss.d` (or `s.ds`) stamp for the
 * gutter. Negative/NaN inputs clamp to 0. Used to show time since the run's
 * first log line.
 */
export function formatElapsed(ms: number): string {
  const safe = Number.isFinite(ms) && ms > 0 ? ms : 0;
  const totalSeconds = safe / 1000;
  if (totalSeconds < 60) {
    return `${totalSeconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * Elapsed ms between a line's timestamp and the first line's timestamp. Returns
 * 0 when there is no baseline or timestamps are unparseable/out of order.
 */
export function elapsedMs(createdAt: string, baseline: string | undefined): number {
  if (!baseline) return 0;
  const t = Date.parse(createdAt);
  const base = Date.parse(baseline);
  if (Number.isNaN(t) || Number.isNaN(base)) return 0;
  return Math.max(0, t - base);
}

/**
 * Filter log lines to only those whose (normalized) stream level is enabled.
 * An empty enabled-set yields an empty list (all levels toggled off).
 */
export function filterLogs<T extends LogLineLike>(
  logs: T[],
  enabled: Set<LogLevel> | ReadonlyArray<LogLevel>
): T[] {
  const set = enabled instanceof Set ? enabled : new Set(enabled);
  return logs.filter((l) => set.has(normalizeLevel(l.stream)));
}
