/**
 * Git-backed test mutations (#6).
 *
 * When enabled, file-level test changes made through the API (upload / delete /
 * rename) are committed — and optionally pushed — so that scheduled and remote
 * runs, which always clone a fresh copy of the repo, pick up the change.
 *
 * The pure helpers here (flag parsing, commit-message construction) are unit-
 * tested; the side-effecting `commitTestMutation` shells out to git and is
 * intentionally best-effort: a git failure must never break the API response,
 * because the on-disk change has already been applied.
 */

import { execFileSync } from "child_process";
import path from "path";

/** A single file change to record in git. */
export interface GitFileChange {
  /** Repo-relative path (e.g. "app_tests/foo.spec.ts"). */
  file: string;
  /** "add" stages a created/modified file; "remove" stages a deletion. */
  op: "add" | "remove";
  /**
   * Force-stage the file even if it is gitignored (`git add -f`). Needed for
   * uploaded specs, which live under a normally-ignored runtime directory but
   * must be versioned when git-backed mode is on so they reach remote clones.
   */
  force?: boolean;
}

export interface GitMutationOptions {
  /** Absolute path to the git working tree (defaults to the project root). */
  repoRoot: string;
  changes: GitFileChange[];
  message: string;
  /** Push to the tracking remote after committing. Defaults to env flag. */
  push?: boolean;
  /** Injected runner (for tests); defaults to a real git invocation. */
  runGit?: (args: string[], cwd: string) => void;
}

/** True when git-backed mutations are turned on via `GIT_BACKED_TESTS`. */
export function isGitBackedEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isTruthyFlag(env.GIT_BACKED_TESTS);
}

/** True when commits should also be pushed, via `GIT_BACKED_PUSH`. */
export function isGitPushEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isTruthyFlag(env.GIT_BACKED_PUSH);
}

function isTruthyFlag(v: string | undefined): boolean {
  if (!v) return false;
  return ["1", "true", "yes", "on"].includes(v.trim().toLowerCase());
}

/**
 * Build a conventional, human-readable commit message for a test mutation.
 * Pure and unit-testable. `detail` is an optional short suffix (e.g. a title).
 */
export function buildCommitMessage(
  action: "upload" | "delete" | "rename",
  target: string,
  detail?: string
): string {
  const verb = { upload: "add", delete: "remove", rename: "rename" }[action];
  const scope = "app-tests";
  const base = `test(${scope}): ${verb} ${target}`;
  return detail ? `${base} (${detail})` : base;
}

/**
 * Normalize a file path to a clean, forward-slashed, repo-relative form for use
 * in `git add`/`git rm`. Absolute paths are made relative to `repoRoot`. Pure.
 */
export function toRepoRelative(file: string, repoRoot: string): string {
  const rel = path.isAbsolute(file) ? path.relative(repoRoot, file) : file;
  return rel.split(path.sep).join("/");
}

function defaultRunGit(args: string[], cwd: string): void {
  execFileSync("git", args, { cwd, stdio: "pipe", timeout: 30_000 });
}

/**
 * Stage the given changes, commit them, and (optionally) push. Best-effort:
 * returns a result describing what happened instead of throwing, so callers can
 * log a warning without failing the request. A no-op (empty changes) returns
 * `{ committed: false }`.
 */
export function commitTestMutation(opts: GitMutationOptions): {
  committed: boolean;
  pushed: boolean;
  message?: string;
  error?: string;
} {
  const { repoRoot, changes, message } = opts;
  if (!changes || changes.length === 0) {
    return { committed: false, pushed: false };
  }
  const runGit = opts.runGit ?? defaultRunGit;
  const shouldPush = opts.push ?? isGitPushEnabled();

  try {
    for (const change of changes) {
      const rel = toRepoRelative(change.file, repoRoot);
      if (change.op === "remove") {
        // --ignore-unmatch: file may already be gone (e.g. rm happened on disk).
        runGit(["rm", "-f", "--ignore-unmatch", "--", rel], repoRoot);
      } else {
        const addArgs = change.force ? ["add", "-f", "--", rel] : ["add", "--", rel];
        runGit(addArgs, repoRoot);
      }
    }
    runGit(["commit", "-m", message], repoRoot);
    let pushed = false;
    if (shouldPush) {
      runGit(["push"], repoRoot);
      pushed = true;
    }
    return { committed: true, pushed, message };
  } catch (err) {
    return {
      committed: false,
      pushed: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
