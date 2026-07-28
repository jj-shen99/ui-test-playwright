/**
 * Pure helpers for reasoning about a target application URL (enhancement #3).
 *
 * The test runner treats a target URL's *origin* as the auth/login target and
 * any deep-link path+query as the navigation target (mirrors the origin
 * normalization in app_tests/fixtures/auth.setup.ts). Kept framework-free so it
 * can be unit-tested without a DOM.
 */

export interface TargetUrlInfo {
  raw: string;
  /** true when the trimmed input parses as an absolute http(s) URL. */
  valid: boolean;
  /** scheme + host used for authentication/login (null when invalid/empty). */
  origin: string | null;
  /** pathname+search used for navigation, or null when just an origin. */
  path: string | null;
  /** true when the URL carries a path beyond "/" or a query string. */
  isDeepLink: boolean;
}

export function describeTargetUrl(raw: string): TargetUrlInfo {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) {
    return { raw: trimmed, valid: false, origin: null, path: null, isDeepLink: false };
  }
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return { raw: trimmed, valid: false, origin: null, path: null, isDeepLink: false };
    }
    const hasPath = u.pathname !== "/" && u.pathname !== "";
    const isDeepLink = hasPath || u.search !== "";
    return {
      raw: trimmed,
      valid: true,
      origin: u.origin,
      path: isDeepLink ? `${u.pathname}${u.search}` : null,
      isDeepLink,
    };
  } catch {
    return { raw: trimmed, valid: false, origin: null, path: null, isDeepLink: false };
  }
}
