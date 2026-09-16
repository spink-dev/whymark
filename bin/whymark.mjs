#!/usr/bin/env node
// Prefer the TypeScript source in a full checkout (tsx present).
// `npx whymark` uses the bundled CLI so it does not need tsx or Next.js.
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "src", "cli", "whymark.ts");
const tsx = join(root, "node_modules", ".bin", "tsx");
const bundled = join(root, "dist", "whymark.mjs");

if (existsSync(tsx) && existsSync(source)) {
  const result = spawnSync(tsx, [source, ...process.argv.slice(2)], {
    stdio: "inherit",
    cwd: process.cwd(),
  });
  process.exit(result.status ?? 1);
}

if (!existsSync(bundled)) {
  process.stderr.write(
    "whymark: CLI bundle missing. From a full checkout run `npm install` (and `npm run build:cli`).\n",
  );
  process.exit(1);
}

await import(pathToFileURL(bundled).href);
