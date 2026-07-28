/**
 * Unit tests for the artifact viewer classifier (#9).
 *
 * Techniques: decision table (kind × extension), equivalence partitioning
 * across viewer classes, and boundary/edge cases for extension parsing.
 */

import { describe, it, expect } from "vitest";
import { classifyArtifact, extensionOf } from "../../services/shared/artifacts";

describe("extensionOf", () => {
  it("extracts a simple lowercased extension", () => {
    expect(extensionOf("shot.PNG")).toBe(".png");
  });

  it("uses the last dot for multi-dot names", () => {
    expect(extensionOf("trace.min.zip")).toBe(".zip");
  });

  it("drops query and hash before parsing", () => {
    expect(extensionOf("https://s3/x/video.webm?sig=abc#t=1")).toBe(".webm");
  });

  it("handles paths with directories", () => {
    expect(extensionOf("/a/b/c/report.json")).toBe(".json");
  });

  it("returns empty for no extension or empty input", () => {
    expect(extensionOf("Makefile")).toBe("");
    expect(extensionOf("")).toBe("");
  });
});

describe("classifyArtifact: kind is authoritative", () => {
  it("classifies trace kind as trace", () => {
    expect(classifyArtifact("trace", "x.bin")).toBe("trace");
  });
  it("classifies screenshot kind as image", () => {
    expect(classifyArtifact("screenshot", "no-ext")).toBe("image");
  });
  it("classifies video kind as video", () => {
    expect(classifyArtifact("video", "no-ext")).toBe("video");
  });
  it("classifies log kind as text", () => {
    expect(classifyArtifact("log", "no-ext")).toBe("text");
  });
});

describe("classifyArtifact: extension refines unknown kinds", () => {
  it.each([
    [".png", "image"],
    [".jpeg", "image"],
    [".svg", "image"],
    [".webm", "video"],
    [".mp4", "video"],
    [".log", "text"],
    [".json", "text"],
    [".zip", "trace"],
  ])("classifies %s as %s", (ext, expected) => {
    expect(classifyArtifact(undefined, `file${ext}`)).toBe(expected);
  });

  it("falls back to download for unknown kind + extension", () => {
    expect(classifyArtifact("misc", "file.bin")).toBe("download");
    expect(classifyArtifact(null, null)).toBe("download");
  });
});
