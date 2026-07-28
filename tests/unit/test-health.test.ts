/**
 * Unit tests for the flaky/quarantine badge helper (#10): healthBadge.
 *
 * Techniques: equivalence partitioning across severity classes, boundary value
 * analysis around the watch/quarantine thresholds, and edge cases (nullish
 * input, out-of-range / NaN scores).
 */

import { describe, it, expect } from "vitest";
import {
  healthBadge,
  QUARANTINE_THRESHOLD,
  WATCH_THRESHOLD,
} from "../../frontend/src/testHealth";

describe("healthBadge", () => {
  it("returns null for missing health data", () => {
    expect(healthBadge(undefined)).toBeNull();
    expect(healthBadge(null)).toBeNull();
  });

  it("returns null for a healthy test below the watch threshold", () => {
    expect(healthBadge({ flakinessScore: 0.01, quarantined: false })).toBeNull();
  });

  it("classifies a quarantined test regardless of score", () => {
    const badge = healthBadge({ flakinessScore: 0.9, quarantined: true })!;
    expect(badge.severity).toBe("quarantined");
    expect(badge.label).toBe("Quarantined");
    expect(badge.percent).toBe(90);
  });

  it("classifies a high non-quarantined score as flaky (boundary at threshold)", () => {
    const badge = healthBadge({ flakinessScore: QUARANTINE_THRESHOLD, quarantined: false })!;
    expect(badge.severity).toBe("flaky");
    expect(badge.percent).toBe(Math.round(QUARANTINE_THRESHOLD * 100));
  });

  it("classifies a mid score as watch (at the watch boundary)", () => {
    const badge = healthBadge({ flakinessScore: WATCH_THRESHOLD, quarantined: false })!;
    expect(badge.severity).toBe("watch");
  });

  it("just below the watch threshold produces no badge (boundary)", () => {
    expect(healthBadge({ flakinessScore: WATCH_THRESHOLD - 0.001, quarantined: false })).toBeNull();
  });

  it("clamps out-of-range and NaN scores when computing percent", () => {
    expect(healthBadge({ flakinessScore: 1.5, quarantined: true })!.percent).toBe(100);
    expect(healthBadge({ flakinessScore: NaN, quarantined: true })!.percent).toBe(0);
  });
});
