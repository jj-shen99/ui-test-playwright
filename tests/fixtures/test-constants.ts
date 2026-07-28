/**
 * Shared constants for the deterministic test environment.
 * Absolute time range matching the seed window (§7.4).
 */

/** Seed window start: 2025-01-01T00:00:00Z */
export const SEED_FROM_EPOCH_MS = 1735689600000;

/** Seed window end: 2025-01-01T06:00:00Z */
export const SEED_TO_EPOCH_MS = 1735711200000;

/** Instances in the seed dataset */
export const SEED_INSTANCES = ["host-a", "host-b", "host-c"] as const;

/** Number of series per metric (one per instance) */
export const SEED_INSTANCE_COUNT = SEED_INSTANCES.length;

/** Build a Grafana URL with absolute time range for deterministic queries */
export function dashboardUrl(
  uid: string,
  params: Record<string, string> = {}
): string {
  const searchParams = new URLSearchParams({
    from: String(SEED_FROM_EPOCH_MS),
    to: String(SEED_TO_EPOCH_MS),
    ...params,
  });
  return `/d/${uid}?${searchParams.toString()}`;
}
