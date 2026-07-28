/**
 * Secret redaction helpers (enhancement #18).
 *
 * Two responsibilities:
 * 1. Mask secret-valued config keys before they leave the API (`redactConfig`).
 * 2. Scrub literal secret values out of free-form text such as run logs
 *    (`redactSecrets`) so credentials passed to Playwright never surface in the
 *    streamed console output.
 */

/** Config keys whose values are secrets and must never be returned in clear. */
export const SECRET_CONFIG_KEYS = new Set<string>([
  "grafanaAuthPassword",
  "grafanaAuthToken",
  "vmAuthPassword",
  "vmAuthToken",
]);

/** Placeholder substituted for any redacted secret occurrence in text. */
export const REDACTION_PLACEHOLDER = "«redacted»";

/**
 * Mask a secret for display: reveals nothing about the value other than that it
 * is set. Short secrets are fully masked; longer ones keep the last 2 chars as
 * a recognizability aid (a common, low-risk convention).
 */
export function maskSecret(value: string | null | undefined): string {
  if (!value) return "";
  if (value.length <= 6) return "••••";
  return "••••" + value.slice(-2);
}

/**
 * Return a copy of a config object with secret keys masked. Non-secret keys are
 * untouched. Empty secret values stay empty (so the UI can show "not set").
 */
export function redactConfig(
  config: Record<string, string>
): Record<string, string> {
  const out: Record<string, string> = { ...config };
  for (const key of Object.keys(out)) {
    if (SECRET_CONFIG_KEYS.has(key) && out[key]) {
      out[key] = maskSecret(out[key]);
    }
  }
  return out;
}

/**
 * Replace every occurrence of each provided secret in `text` with the redaction
 * placeholder. Secrets shorter than 3 chars are ignored (too generic — masking
 * them would garble unrelated output). Order-independent and idempotent.
 */
export function redactSecrets(
  text: string,
  secrets: Array<string | null | undefined>
): string {
  if (!text) return text;
  let out = text;
  // Longest-first so a secret that contains another is redacted whole.
  const unique = Array.from(
    new Set(secrets.filter((s): s is string => typeof s === "string" && s.length >= 3))
  ).sort((a, b) => b.length - a.length);
  for (const secret of unique) {
    out = out.split(secret).join(REDACTION_PLACEHOLDER);
  }
  return out;
}
