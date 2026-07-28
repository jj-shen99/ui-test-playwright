/**
 * Unit tests for describeTargetUrl (enhancement #3).
 *
 * Techniques:
 * - Equivalence partitioning: origin-only vs deep-link vs invalid vs empty.
 * - Boundary values: bare origin ("/" path), trailing slash, query-only.
 * - Decision table: (has path) × (has query) → isDeepLink / path.
 * - Security/robustness: rejects non-http(s) schemes (javascript:, file:).
 */

import { describe, it, expect } from "vitest";
import { describeTargetUrl } from "../../frontend/src/targetUrl";

describe("describeTargetUrl", () => {
  it("treats an empty/whitespace string as invalid", () => {
    expect(describeTargetUrl("")).toMatchObject({ valid: false, origin: null });
    expect(describeTargetUrl("   ")).toMatchObject({ valid: false, origin: null });
  });

  it("parses a bare origin (no deep link)", () => {
    const info = describeTargetUrl("https://grafana.example.com");
    expect(info).toMatchObject({
      valid: true,
      origin: "https://grafana.example.com",
      path: null,
      isDeepLink: false,
    });
  });

  it("treats a trailing-slash root as not a deep link", () => {
    const info = describeTargetUrl("https://grafana.example.com/");
    expect(info.isDeepLink).toBe(false);
    expect(info.path).toBeNull();
  });

  it("extracts origin and path for a deep dashboard link", () => {
    const info = describeTargetUrl(
      "https://g.example.com/d/abc/my-dash?orgId=1&var-x=$__all"
    );
    expect(info.origin).toBe("https://g.example.com");
    expect(info.path).toBe("/d/abc/my-dash?orgId=1&var-x=$__all");
    expect(info.isDeepLink).toBe(true);
  });

  it("flags a query-only URL as a deep link", () => {
    const info = describeTargetUrl("https://g.example.com/?orgId=1");
    expect(info.isDeepLink).toBe(true);
    expect(info.path).toBe("/?orgId=1");
  });

  it("trims surrounding whitespace before parsing", () => {
    const info = describeTargetUrl("  https://g.example.com/d/x  ");
    expect(info.valid).toBe(true);
    expect(info.origin).toBe("https://g.example.com");
  });

  it("supports http as well as https", () => {
    expect(describeTargetUrl("http://localhost:3000").origin).toBe(
      "http://localhost:3000"
    );
  });

  it.each(["javascript:alert(1)", "file:///etc/passwd", "not a url", "ftp://x"])(
    "rejects non-http(s) or malformed input %s",
    (bad) => {
      expect(describeTargetUrl(bad)).toMatchObject({ valid: false, origin: null });
    }
  );
});
