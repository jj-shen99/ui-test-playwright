/**
 * Pure helpers for flaky / quarantine badges (#10).
 *
 * Turns a test_health entry (flakiness score 0..1 + quarantined flag) into a
 * small badge descriptor the catalog and run views render consistently.
 */

export interface TestHealthEntry {
  flakinessScore: number;
  quarantined: boolean;
  updatedAt?: string;
}

export type HealthSeverity = "quarantined" | "flaky" | "watch" | "healthy";

export interface HealthBadge {
  severity: HealthSeverity;
  label: string;
  /** Flakiness as a whole-number percentage (0..100). */
  percent: number;
  title: string;
}

/** Score at/above which the ML pipeline auto-quarantines (mirrors analyze.py). */
export const QUARANTINE_THRESHOLD = 0.15;
/** Below this (and not quarantined) a test is considered healthy — no badge. */
export const WATCH_THRESHOLD = 0.05;

/**
 * Classify a health entry into a badge. Returns null when there is nothing
 * worth surfacing (no entry, or a healthy test below the watch threshold).
 */
export function healthBadge(entry: TestHealthEntry | undefined | null): HealthBadge | null {
  if (!entry) return null;
  const score = Number.isFinite(entry.flakinessScore) ? entry.flakinessScore : 0;
  const percent = Math.round(Math.max(0, Math.min(1, score)) * 100);

  if (entry.quarantined) {
    return {
      severity: "quarantined",
      label: "Quarantined",
      percent,
      title: `Auto-quarantined — ${percent}% flaky`,
    };
  }
  if (score >= QUARANTINE_THRESHOLD) {
    return { severity: "flaky", label: `${percent}% flaky`, percent, title: `${percent}% flaky` };
  }
  if (score >= WATCH_THRESHOLD) {
    return { severity: "watch", label: `${percent}% flaky`, percent, title: `${percent}% flaky` };
  }
  return null;
}
