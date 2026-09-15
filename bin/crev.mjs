#!/usr/bin/env node
// Thin wrapper so `crev` works without a build step: tsx compiles the CLI on the fly.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const entry = join(root, "src", "cli", "crev.ts");
const tsx = join(root, "node_modules", ".bin", "tsx");

const result = spawnSync(tsx, [entry, ...process.argv.slice(2)], {
  stdio: "inherit",
  cwd: process.cwd(),
});
process.exit(result.status ?? 1);
