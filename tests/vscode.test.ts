import { describe, expect, it } from "vitest";
import { realpathSync, mkdtempSync, writeFileSync, mkdirSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { parseRequest } from "../extensions/vscode/src/protocol";
import { blobHash, safeFile } from "../extensions/vscode/src/safety";
import { collectDiff } from "../src/lib/whymark/git";

describe("VS Code boundary", () => {
  it("accepts typed operations and rejects malformed or executable messages", () => {
    expect(parseRequest({ type: "edit", id: 1, revision: 1, path: "a.ts", start: 1, end: 1, text: "new" })).not.toBeNull();
    for (const request of [
      { type: "external", url: "command:workbench.action.terminal.new" },
      { type: "apply", id: 1, revision: 1, path: "a", decisions: { discardAdded: [-1], restoreDeleted: [] } },
      { type: "edit", id: 1, revision: 1, path: "a", start: 2, end: 1, text: "" },
      { type: "execute", command: "rm" }, null,
    ]) expect(parseRequest(request)).toBeNull();
  });
  it("contains source paths including symlink escapes and excludes Git metadata", async () => {
    const root = mkdtempSync(join(tmpdir(), "whymark-path-"));
    const outside = mkdtempSync(join(tmpdir(), "whymark-outside-"));
    try {
      writeFileSync(join(root, "a.ts"), "ok"); writeFileSync(join(outside, "secret"), "no");
      mkdirSync(join(root, ".git")); writeFileSync(join(root, ".git/config"), "no");
      symlinkSync(outside, join(root, "escape"));
      expect(await safeFile(root, "a.ts")).toBe(realpathSync(join(root, "a.ts")));
      for (const path of ["../secret", "/etc/passwd", "escape/secret", ".git/config", "C:/secret", "..\\secret"]) await expect(safeFile(root, path)).rejects.toThrow();
    } finally { rmSync(root, { recursive: true }); rmSync(outside, { recursive: true }); }
  });
  it("keeps index, unstaged, all-working and branch comparisons distinct", () => {
    const cwd = mkdtempSync(join(tmpdir(), "whymark-git-vscode-"));
    const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
    try {
      git("init", "-q", "-b", "main"); git("config", "user.name", "Test"); git("config", "user.email", "test@example.com");
      writeFileSync(join(cwd, "a.ts"), "base\n"); git("add", "."); git("commit", "-qm", "base");
      writeFileSync(join(cwd, "a.ts"), "staged\n"); git("add", "."); writeFileSync(join(cwd, "a.ts"), "unstaged\n");
      writeFileSync(join(cwd, "new.ts"), "untracked\n");
      const staged = collectDiff({ cwd, scope: "staged", untracked: true });
      expect(staged.files).toHaveLength(1); expect(staged.raw).toContain("+staged"); expect(staged.raw).not.toContain("+unstaged");
      const unstaged = collectDiff({ cwd, scope: "unstaged", untracked: true });
      expect(unstaged.files).toHaveLength(2); expect(unstaged.raw).toContain("-staged"); expect(unstaged.raw).toContain("+unstaged");
      expect(collectDiff({ cwd, scope: "worktree" }).raw).toContain("-base");
      expect(collectDiff({ cwd, scope: "branch", base: "main" }).files).toHaveLength(0);
      expect(blobHash("unstaged\n")).toBe(git("hash-object", "a.ts"));
    } finally { rmSync(cwd, { recursive: true }); }
  });
});
