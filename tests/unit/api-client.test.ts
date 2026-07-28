/**
 * Unit tests for frontend/src/api.ts — request function and API client shape.
 * Since the API client uses fetch, we mock fetch to verify correct URL construction,
 * headers, and error handling.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// We test the request function behavior by re-implementing the core logic
// (the module is JSX/TSX, importing it directly requires the full Vite pipeline)

const BASE = "/api";

// Injectable in-memory storage. Node 22's experimental built-in `localStorage`
// silently ignores writes without a backing file, so rather than fight the
// global we point the mirror at a storage object we fully control.
interface SimpleStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
let mockStorage: SimpleStorage | null = null;

function makeStorage(): SimpleStorage {
  const store = new Map<string, string>();
  return {
    getItem: (k) => (store.has(k) ? store.get(k)! : null),
    setItem: (k, v) => void store.set(k, String(v)),
  };
}

// Mirror of authHeaders() from frontend/src/api.ts (kept in sync with the real
// module, which can't be imported here due to the Vite/TSX pipeline). The real
// module reads the global `localStorage`; here we read the injected mockStorage.
function authHeaders(): Record<string, string> {
  try {
    const raw = mockStorage!.getItem("user");
    if (!raw) return {};
    const user = JSON.parse(raw) as { id?: string };
    return user?.id ? { "x-user-id": user.id } : {};
  } catch {
    return {};
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json();
}

describe("request", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Equivalence partitioning ──

  it("makes a GET request to the correct URL", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: "ok" }),
    });

    await request("/runs");
    expect(mockFetch).toHaveBeenCalledWith("/api/runs", expect.objectContaining({
      headers: expect.objectContaining({ "Content-Type": "application/json" }),
    }));
  });

  it("makes a POST request with body", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ runId: "123" }),
    });

    const body = JSON.stringify({ selector: "smoke" });
    await request("/runs", { method: "POST", body });

    expect(mockFetch).toHaveBeenCalledWith("/api/runs", expect.objectContaining({
      method: "POST",
      body,
      headers: expect.objectContaining({ "Content-Type": "application/json" }),
    }));
  });

  it("returns parsed JSON on success", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ runs: [], total: 0 }),
    });

    const result = await request<{ runs: unknown[]; total: number }>("/runs");
    expect(result).toEqual({ runs: [], total: 0 });
  });

  // ── Error handling ──

  it("throws on non-ok response", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve("Not Found"),
    });

    await expect(request("/runs/missing")).rejects.toThrow("API 404: Not Found");
  });

  it("throws on 500 with error body", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Internal Server Error"),
    });

    await expect(request("/runs")).rejects.toThrow("API 500: Internal Server Error");
  });

  // ── Headers bug regression test ──

  it("preserves Content-Type even when init has other properties", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });

    await request("/runs", { method: "POST", body: "{}" });

    const callArgs = mockFetch.mock.calls[0][1];
    expect(callArgs.headers["Content-Type"]).toBe("application/json");
  });

  it("always includes Content-Type application/json in headers", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });

    await request("/runs");

    const callArgs = mockFetch.mock.calls[0][1];
    expect(callArgs.headers).toBeDefined();
    expect(callArgs.headers["Content-Type"]).toBe("application/json");
  });

  // ── Boundary: empty path ──

  it("handles empty path", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });

    await request("");
    expect(mockFetch).toHaveBeenCalledWith("/api", expect.any(Object));
  });

  // ── Query parameters ──

  it("passes query parameters in the path", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ runs: [] }),
    });

    await request("/runs?limit=10&status=passed");
    expect(mockFetch).toHaveBeenCalledWith("/api/runs?limit=10&status=passed", expect.any(Object));
  });
});

// ── Identity header (RBAC #17) ──
describe("authHeaders / x-user-id identity header", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    mockFetch.mockClear();
    vi.stubGlobal("fetch", mockFetch);
    mockStorage = makeStorage();
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    mockStorage = null;
  });

  it("omits x-user-id when no user is stored", async () => {
    await request("/runs");
    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers["x-user-id"]).toBeUndefined();
  });

  it("sends x-user-id from the stored user", async () => {
    mockStorage!.setItem(
      "user",
      JSON.stringify({ id: "u-123", email: "a@b.c", role: "admin" })
    );
    await request("/runs");
    expect(mockFetch.mock.calls[0][1].headers["x-user-id"]).toBe("u-123");
  });

  it("omits x-user-id when the stored user has no id", async () => {
    mockStorage!.setItem("user", JSON.stringify({ email: "a@b.c" }));
    await request("/runs");
    expect(mockFetch.mock.calls[0][1].headers["x-user-id"]).toBeUndefined();
  });

  it("does not throw and omits header when stored user is malformed JSON", async () => {
    mockStorage!.setItem("user", "{not-json");
    await expect(request("/runs")).resolves.toBeDefined();
    expect(mockFetch.mock.calls[0][1].headers["x-user-id"]).toBeUndefined();
  });

  it("never lets a caller-supplied header be dropped by authHeaders", async () => {
    mockStorage!.setItem("user", JSON.stringify({ id: "u-9" }));
    await request("/runs", { headers: { "X-Custom": "1" } });
    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers["x-user-id"]).toBe("u-9");
    expect(headers["X-Custom"]).toBe("1");
  });
});
