/**
 * Unit tests for the frontend per-run env-overrides form helper (#15):
 * toEnvOverridesPayload.
 *
 * Techniques: equivalence partitioning (each field), boundary values
 * (blank/zero/negative viewport), decision table (partial viewport), and the
 * empty-form => undefined contract.
 */

import { describe, it, expect } from "vitest";
import {
  emptyEnvOverridesForm,
  toEnvOverridesPayload,
  type EnvOverridesForm,
} from "../../frontend/src/runEnvOverrides";

function form(overrides: Partial<EnvOverridesForm> = {}): EnvOverridesForm {
  return { ...emptyEnvOverridesForm, ...overrides };
}

describe("toEnvOverridesPayload", () => {
  it("returns undefined for a wholly empty form", () => {
    expect(toEnvOverridesPayload(emptyEnvOverridesForm)).toBeUndefined();
  });

  it("includes viewport only when both width and height parse", () => {
    expect(
      toEnvOverridesPayload(form({ viewportWidth: "1280", viewportHeight: "720" }))
    ).toEqual({ viewportWidth: 1280, viewportHeight: 720 });

    expect(toEnvOverridesPayload(form({ viewportWidth: "1280" }))).toBeUndefined();
    expect(toEnvOverridesPayload(form({ viewportHeight: "720" }))).toBeUndefined();
  });

  it("drops non-numeric / zero / negative viewport values", () => {
    expect(
      toEnvOverridesPayload(form({ viewportWidth: "abc", viewportHeight: "720" }))
    ).toBeUndefined();
    expect(
      toEnvOverridesPayload(form({ viewportWidth: "0", viewportHeight: "720" }))
    ).toBeUndefined();
    expect(
      toEnvOverridesPayload(form({ viewportWidth: "-5", viewportHeight: "720" }))
    ).toBeUndefined();
  });

  it("passes through timezone", () => {
    expect(toEnvOverridesPayload(form({ timezone: "utc" }))).toEqual({ timezone: "utc" });
  });

  it("passes through and trims time range values", () => {
    expect(
      toEnvOverridesPayload(form({ timeFrom: "  now-6h ", timeTo: " now " }))
    ).toEqual({ timeFrom: "now-6h", timeTo: "now" });
  });

  it("combines multiple fields", () => {
    expect(
      toEnvOverridesPayload(
        form({
          viewportWidth: "1920",
          viewportHeight: "1080",
          timezone: "America/New_York",
          timeFrom: "now-1d",
        })
      )
    ).toEqual({
      viewportWidth: 1920,
      viewportHeight: 1080,
      timezone: "America/New_York",
      timeFrom: "now-1d",
    });
  });

  it("ignores whitespace-only entries", () => {
    expect(
      toEnvOverridesPayload(form({ timezone: "   ", timeFrom: "  " }))
    ).toBeUndefined();
  });
});
