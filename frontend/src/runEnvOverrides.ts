/**
 * Pure helpers for the per-run environment overrides form (#15): viewport,
 * timezone, and dashboard time range. The form holds raw strings; this module
 * converts them into the typed `envOverrides` payload the API expects, dropping
 * blank/invalid entries so an empty form sends nothing at all.
 */

export interface EnvOverridesForm {
  viewportWidth: string;
  viewportHeight: string;
  timezone: string;
  timeFrom: string;
  timeTo: string;
}

export const emptyEnvOverridesForm: EnvOverridesForm = {
  viewportWidth: "",
  viewportHeight: "",
  timezone: "",
  timeFrom: "",
  timeTo: "",
};

export interface EnvOverridesPayload {
  viewportWidth?: number;
  viewportHeight?: number;
  timezone?: string;
  timeFrom?: string;
  timeTo?: string;
}

/** Common Grafana timezone choices offered in the dropdown. */
export const TIMEZONE_OPTIONS = [
  { value: "", label: "Default (browser)" },
  { value: "utc", label: "UTC" },
  { value: "browser", label: "Browser local" },
  { value: "America/New_York", label: "America/New_York" },
  { value: "America/Los_Angeles", label: "America/Los_Angeles" },
  { value: "Europe/London", label: "Europe/London" },
  { value: "Asia/Kolkata", label: "Asia/Kolkata" },
  { value: "Asia/Shanghai", label: "Asia/Shanghai" },
];

function parsePositiveInt(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (!/^\d+$/.test(trimmed)) return undefined;
  const n = Number(trimmed);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/**
 * Build the `envOverrides` payload from the form, or `undefined` when nothing
 * meaningful is set (so the trigger request omits the field entirely). Viewport
 * width and height are only included when BOTH parse to positive integers.
 */
export function toEnvOverridesPayload(
  form: EnvOverridesForm
): EnvOverridesPayload | undefined {
  const payload: EnvOverridesPayload = {};

  const w = parsePositiveInt(form.viewportWidth);
  const h = parsePositiveInt(form.viewportHeight);
  if (w !== undefined && h !== undefined) {
    payload.viewportWidth = w;
    payload.viewportHeight = h;
  }

  const tz = form.timezone.trim();
  if (tz) payload.timezone = tz;

  const from = form.timeFrom.trim();
  if (from) payload.timeFrom = from;

  const to = form.timeTo.trim();
  if (to) payload.timeTo = to;

  return Object.keys(payload).length > 0 ? payload : undefined;
}
