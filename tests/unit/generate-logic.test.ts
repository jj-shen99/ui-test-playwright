/**
 * Unit tests for Generate page validation / logic.
 * Tests JSON parsing, mode selection, and submission gating.
 */

import { describe, it, expect } from "vitest";

// ── Replicate the canSubmit logic from Generate.tsx ──

type GenerateMode = "uid" | "json";

function canSubmit(mode: GenerateMode, uid: string, json: string): boolean {
  return (
    (mode === "uid" && uid.trim().length > 0) ||
    (mode === "json" && json.trim().length > 0)
  );
}

function parseJsonSafe(text: string): { ok: boolean; data?: unknown; error?: string } {
  try {
    const data = JSON.parse(text);
    return { ok: true, data };
  } catch {
    return { ok: false, error: "Invalid JSON — check your dashboard JSON and try again." };
  }
}

function buildGeneratePayload(
  mode: GenerateMode,
  uid: string,
  json: string,
  useLlm: boolean
): { dashboardUid?: string; dashboardJson?: unknown; useLlm: boolean } | { error: string } {
  if (mode === "uid") {
    if (!uid.trim()) return { error: "Dashboard UID is required" };
    return { dashboardUid: uid.trim(), useLlm };
  }
  const parsed = parseJsonSafe(json);
  if (!parsed.ok) return { error: parsed.error! };
  return { dashboardJson: parsed.data, useLlm };
}

// ── Tests ──

describe("Generate page — canSubmit", () => {
  // ── Equivalence partitioning: uid mode ──

  it("returns true for uid mode with non-empty uid", () => {
    expect(canSubmit("uid", "abc123", "")).toBe(true);
  });

  it("returns false for uid mode with empty uid", () => {
    expect(canSubmit("uid", "", "")).toBe(false);
  });

  it("returns false for uid mode with whitespace-only uid", () => {
    expect(canSubmit("uid", "   ", "")).toBe(false);
  });

  // ── Equivalence partitioning: json mode ──

  it("returns true for json mode with non-empty json", () => {
    expect(canSubmit("json", "", '{"panels":[]}' )).toBe(true);
  });

  it("returns false for json mode with empty json", () => {
    expect(canSubmit("json", "", "")).toBe(false);
  });

  it("returns false for json mode with whitespace-only json", () => {
    expect(canSubmit("json", "", "   ")).toBe(false);
  });

  // ── Cross-mode: uid ignored in json mode ──

  it("uid value is irrelevant in json mode", () => {
    expect(canSubmit("json", "some-uid", "")).toBe(false);
  });

  it("json value is irrelevant in uid mode", () => {
    expect(canSubmit("uid", "", '{"panels":[]}')).toBe(false);
  });
});

describe("Generate page — JSON parsing", () => {
  it("parses valid JSON", () => {
    const result = parseJsonSafe('{"title":"Dashboard"}');
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ title: "Dashboard" });
  });

  it("rejects invalid JSON", () => {
    const result = parseJsonSafe("{not valid}");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Invalid JSON");
  });

  it("rejects empty string", () => {
    const result = parseJsonSafe("");
    expect(result.ok).toBe(false);
  });

  it("parses a full dashboard JSON structure", () => {
    const json = JSON.stringify({
      uid: "abc",
      title: "CPU Metrics",
      panels: [{ id: 1, type: "graph" }],
      templating: { list: [] },
    });
    const result = parseJsonSafe(json);
    expect(result.ok).toBe(true);
    expect((result.data as any).uid).toBe("abc");
  });

  it("accepts arrays (edge case)", () => {
    const result = parseJsonSafe("[]");
    expect(result.ok).toBe(true);
  });

  it("accepts primitives wrapped in JSON", () => {
    const result = parseJsonSafe('"hello"');
    expect(result.ok).toBe(true);
    expect(result.data).toBe("hello");
  });
});

describe("Generate page — buildGeneratePayload", () => {
  // ── UID mode ──

  it("builds uid payload correctly", () => {
    const result = buildGeneratePayload("uid", "PBFA97CFB590B2093", "", false);
    expect(result).toEqual({
      dashboardUid: "PBFA97CFB590B2093",
      useLlm: false,
    });
  });

  it("trims uid whitespace", () => {
    const result = buildGeneratePayload("uid", "  abc  ", "", true);
    expect(result).toEqual({ dashboardUid: "abc", useLlm: true });
  });

  it("returns error for empty uid", () => {
    const result = buildGeneratePayload("uid", "", "", false);
    expect("error" in result).toBe(true);
  });

  // ── JSON mode ──

  it("builds json payload correctly", () => {
    const result = buildGeneratePayload("json", "", '{"panels":[]}', false);
    expect("dashboardJson" in result).toBe(true);
    expect((result as any).dashboardJson).toEqual({ panels: [] });
  });

  it("returns error for invalid json", () => {
    const result = buildGeneratePayload("json", "", "not json", false);
    expect("error" in result).toBe(true);
  });

  // ── LLM flag ──

  it("passes useLlm=true through", () => {
    const result = buildGeneratePayload("uid", "abc", "", true);
    expect((result as any).useLlm).toBe(true);
  });

  it("passes useLlm=false through", () => {
    const result = buildGeneratePayload("uid", "abc", "", false);
    expect((result as any).useLlm).toBe(false);
  });
});

// ── Remote target + auth payload (mirrors Generate.tsx targetPayload) ──

type AuthType = "none" | "basic" | "token";

interface TargetConfig {
  targetUrl: string;
  authType: AuthType;
  authUsername: string;
  authPassword: string;
  authToken: string;
}

function buildTargetPayload(t: TargetConfig) {
  return {
    targetUrl: t.targetUrl.trim() || undefined,
    authType: t.authType,
    authUsername: t.authUsername.trim() || undefined,
    authPassword: t.authPassword || undefined,
    authToken: t.authToken.trim() || undefined,
  };
}

const emptyTarget: TargetConfig = {
  targetUrl: "",
  authType: "none",
  authUsername: "",
  authPassword: "",
  authToken: "",
};

describe("Generate page — buildTargetPayload", () => {
  it("omits URL and credentials when everything is blank (local Grafana)", () => {
    expect(buildTargetPayload(emptyTarget)).toEqual({
      targetUrl: undefined,
      authType: "none",
      authUsername: undefined,
      authPassword: undefined,
      authToken: undefined,
    });
  });

  it("trims the remote URL", () => {
    const p = buildTargetPayload({ ...emptyTarget, targetUrl: "  https://g.example.com  " });
    expect(p.targetUrl).toBe("https://g.example.com");
  });

  it("passes basic-auth username (trimmed) and password", () => {
    const p = buildTargetPayload({
      ...emptyTarget,
      targetUrl: "https://g.example.com",
      authType: "basic",
      authUsername: "  admin  ",
      authPassword: "s3cret",
    });
    expect(p.authType).toBe("basic");
    expect(p.authUsername).toBe("admin");
    expect(p.authPassword).toBe("s3cret");
    expect(p.authToken).toBeUndefined();
  });

  it("passes a bearer token (trimmed) and omits basic fields", () => {
    const p = buildTargetPayload({
      ...emptyTarget,
      targetUrl: "https://g.example.com",
      authType: "token",
      authToken: "  glsa_abc123  ",
    });
    expect(p.authType).toBe("token");
    expect(p.authToken).toBe("glsa_abc123");
    expect(p.authUsername).toBeUndefined();
    expect(p.authPassword).toBeUndefined();
  });
});
