/**
 * Pure helpers for the inline artifact viewer (enhancement #9).
 *
 * Given an artifact's kind and object URI, decide how the UI should present it:
 *  - 'image'    → render inline as <img> (screenshots, png/jpg)
 *  - 'video'    → render inline as <video> (webm/mp4 recordings)
 *  - 'text'     → fetch and show as text (logs, plain text)
 *  - 'trace'    → Playwright trace .zip — offer download + trace-viewer hint
 *  - 'download' → anything else, offer a download link
 */

export type ArtifactViewer = "image" | "video" | "text" | "trace" | "download";

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"]);
const VIDEO_EXT = new Set([".webm", ".mp4", ".mov"]);
const TEXT_EXT = new Set([".txt", ".log", ".json"]);

/** Extract a lowercased file extension (incl. dot) from a URI/path, or "". */
export function extensionOf(uri: string): string {
  if (!uri) return "";
  const clean = uri.split(/[?#]/)[0]; // drop query/hash
  const base = clean.substring(clean.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot).toLowerCase() : "";
}

/**
 * Classify an artifact for display. `kind` (the DB column: trace/video/
 * screenshot/log) is authoritative; the extension refines/validates it.
 */
export function classifyArtifact(
  kind: string | null | undefined,
  objectUri: string | null | undefined
): ArtifactViewer {
  const k = (kind ?? "").toLowerCase();
  const ext = extensionOf(objectUri ?? "");

  if (k === "trace" || ext === ".zip") return "trace";
  if (k === "screenshot" || IMAGE_EXT.has(ext)) return "image";
  if (k === "video" || VIDEO_EXT.has(ext)) return "video";
  if (k === "log" || TEXT_EXT.has(ext)) return "text";
  return "download";
}
