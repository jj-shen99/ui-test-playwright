/**
 * Unit tests for git-backed test mutations (#6).
 *
 * Techniques: flag parsing equivalence partitions, commit-message decision
 * table, path normalization boundaries, and a decision table over the
 * add/remove/push branches of commitTestMutation using an injected git runner
 * (no real git invoked).
 */

import { describe, it, expect } from "vitest";
import {
  isGitBackedEnabled,
  isGitPushEnabled,
  buildCommitMessage,
  toRepoRelative,
  commitTestMutation,
  type GitFileChange,
} from "../../services/shared/git";

describe("isGitBackedEnabled / isGitPushEnabled", () => {
  it("is false when the flag is unset or empty", () => {
    expect(isGitBackedEnabled({})).toBe(false);
    expect(isGitBackedEnabled({ GIT_BACKED_TESTS: "" })).toBe(false);
  });

  it("accepts common truthy spellings (case/space-insensitive)", () => {
    for (const v of ["1", "true", "YES", " On "]) {
      expect(isGitBackedEnabled({ GIT_BACKED_TESTS: v })).toBe(true);
    }
  });

  it("rejects falsy spellings", () => {
    for (const v of ["0", "false", "no", "off"]) {
      expect(isGitBackedEnabled({ GIT_BACKED_TESTS: v })).toBe(false);
    }
  });

  it("reads the push flag independently", () => {
    expect(isGitPushEnabled({ GIT_BACKED_PUSH: "true" })).toBe(true);
    expect(isGitPushEnabled({})).toBe(false);
  });
});

describe("buildCommitMessage", () => {
  it("maps each action to its verb", () => {
    expect(buildCommitMessage("upload", "app_tests/a.spec.ts")).toBe(
      "test(app-tests): add app_tests/a.spec.ts"
    );
    expect(buildCommitMessage("delete", "app_tests/a.spec.ts")).toBe(
      "test(app-tests): remove app_tests/a.spec.ts"
    );
    expect(buildCommitMessage("rename", "app_tests/a.spec.ts")).toBe(
      "test(app-tests): rename app_tests/a.spec.ts"
    );
  });

  it("appends an optional detail suffix", () => {
    expect(
      buildCommitMessage("rename", "app_tests/a.spec.ts", '"old" → "new"')
    ).toBe('test(app-tests): rename app_tests/a.spec.ts ("old" → "new")');
  });
});

describe("toRepoRelative", () => {
  const root = "/repo";

  it("passes through already-relative paths (normalized to forward slashes)", () => {
    expect(toRepoRelative("app_tests/a.spec.ts", root)).toBe("app_tests/a.spec.ts");
  });

  it("relativizes absolute paths under the repo root", () => {
    expect(toRepoRelative("/repo/app_tests/a.spec.ts", root)).toBe(
      "app_tests/a.spec.ts"
    );
  });
});

describe("commitTestMutation", () => {
  function recorder() {
    const calls: string[][] = [];
    return {
      calls,
      runGit: (args: string[]) => {
        calls.push(args);
      },
    };
  }

  it("is a no-op with empty changes", () => {
    const rec = recorder();
    const res = commitTestMutation({
      repoRoot: "/repo",
      changes: [],
      message: "m",
      runGit: rec.runGit,
    });
    expect(res.committed).toBe(false);
    expect(rec.calls).toHaveLength(0);
  });

  it("stages adds and removes then commits (no push by default)", () => {
    const rec = recorder();
    const changes: GitFileChange[] = [
      { file: "app_tests/a.spec.ts", op: "add" },
      { file: "app_tests/b.spec.ts", op: "remove" },
    ];
    const res = commitTestMutation({
      repoRoot: "/repo",
      changes,
      message: "test: change",
      push: false,
      runGit: rec.runGit,
    });

    expect(res).toMatchObject({ committed: true, pushed: false });
    expect(rec.calls[0]).toEqual(["add", "--", "app_tests/a.spec.ts"]);
    expect(rec.calls[1]).toEqual([
      "rm",
      "-f",
      "--ignore-unmatch",
      "--",
      "app_tests/b.spec.ts",
    ]);
    expect(rec.calls[2]).toEqual(["commit", "-m", "test: change"]);
    expect(rec.calls.some((c) => c[0] === "push")).toBe(false);
  });

  it("force-adds gitignored files with `git add -f` (upload propagation, #6)", () => {
    const rec = recorder();
    commitTestMutation({
      repoRoot: "/repo",
      changes: [{ file: "app_tests/uploaded/x.spec.ts", op: "add", force: true }],
      message: "test: add upload",
      runGit: rec.runGit,
    });
    expect(rec.calls[0]).toEqual([
      "add",
      "-f",
      "--",
      "app_tests/uploaded/x.spec.ts",
    ]);
  });

  it("does not use -f for a normal (non-forced) add", () => {
    const rec = recorder();
    commitTestMutation({
      repoRoot: "/repo",
      changes: [{ file: "app_tests/a.spec.ts", op: "add" }],
      message: "m",
      runGit: rec.runGit,
    });
    expect(rec.calls[0]).toEqual(["add", "--", "app_tests/a.spec.ts"]);
  });

  it("pushes when push=true", () => {
    const rec = recorder();
    const res = commitTestMutation({
      repoRoot: "/repo",
      changes: [{ file: "app_tests/a.spec.ts", op: "add" }],
      message: "m",
      push: true,
      runGit: rec.runGit,
    });
    expect(res.pushed).toBe(true);
    expect(rec.calls.at(-1)).toEqual(["push"]);
  });

  it("returns an error (never throws) when git fails", () => {
    const res = commitTestMutation({
      repoRoot: "/repo",
      changes: [{ file: "app_tests/a.spec.ts", op: "add" }],
      message: "m",
      runGit: () => {
        throw new Error("fatal: not a git repository");
      },
    });
    expect(res.committed).toBe(false);
    expect(res.error).toContain("not a git repository");
  });
});
