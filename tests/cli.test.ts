import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderHelp } from "../src/cli/help";

const identity = (text: string) => text;
const colors = {
  bold: identity,
  dim: identity,
  cyan: identity,
  gray: identity,
};

const cli = join(import.meta.dirname, "../dist/whymark.mjs");

function run(args: string[]) {
  return spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
}

describe("help", () => {
  it("renders an overview that names every command and npx", () => {
    const page = renderHelp(undefined, colors);
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.text).toContain("npx whymark");
    for (const command of ["new", "prompt", "validate", "verify", "stats", "fmt", "view"]) {
      expect(page.text).toContain(command);
    }
    expect(page.text).toContain("why:");
    expect(page.text).toContain("source:");
    expect(page.text).toContain("verify:");
  });

  it("resolves aliases to the same page", () => {
    const a = renderHelp("init", colors);
    const b = renderHelp("new", colors);
    expect(a).toEqual(b);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.text).toContain("--stubs");
  });

  it("covers how to fill annotations", () => {
    const page = renderHelp("annotate", colors);
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.text).toContain("source: inference");
    expect(page.text).toContain("+42..57");
  });

  it("rejects an unknown topic", () => {
    const page = renderHelp("nope", colors);
    expect(page.ok).toBe(false);
    if (page.ok) return;
    expect(page.message).toContain("npx whymark help");
  });
});

describe("CLI", () => {
  it("prints help for no args, help, and --help", () => {
    for (const args of [[], ["help"], ["--help"], ["-h"]]) {
      const result = run(args);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("npx whymark");
      expect(result.stdout).toContain("WORKFLOW");
    }
  });

  it("prints command help for help <cmd> and <cmd> --help", () => {
    const viaHelp = run(["help", "verify"]);
    const viaFlag = run(["verify", "--help"]);
    expect(viaHelp.status).toBe(0);
    expect(viaFlag.status).toBe(0);
    expect(viaHelp.stdout).toContain("--write");
    expect(viaFlag.stdout).toBe(viaHelp.stdout);
  });

  it("prints the package version, not the caller's", () => {
    const result = run(["version"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^whymark 0\.\d+\.\d+\n$/);
  });

  it("hints at help for an unknown command", () => {
    const result = run(["explode"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("npx whymark help");
  });
});
