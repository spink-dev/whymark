import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { installExtension } from "../src/lib/vscode/install";

it.skipIf(process.platform === "win32")("installs exact packaged bytes using safe arguments and propagates failures", () => {
  const root = mkdtempSync(join(tmpdir(), "whymark installer "));
  try {
    mkdirSync(join(root, "dist"));
    const payload = Buffer.from("fixture VSIX");
    writeFileSync(join(root, "dist/whymark-vscode.vsix"), payload);
    writeFileSync(join(root, "dist/vscode-extension.json"), JSON.stringify({ id: "spink-dev.whymark", version: "0.1.0", sha256: createHash("sha256").update(payload).digest("hex") }));
    const code = join(root, "code launcher");
    const log = join(root, "arguments.json");
    writeFileSync(code, `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(log)},JSON.stringify(process.argv.slice(2)));\n`, { mode: 0o755 });
    const destination = join(root, "extensions ; literal");
    installExtension({ packageRoot: root, code, extensionsDir: destination });
    expect(JSON.parse(readFileSync(log, "utf8"))).toEqual(["--install-extension", join(root, "dist/whymark-vscode.vsix"), "--extensions-dir", destination]);
    installExtension({ packageRoot: root, code, marketplace: true });
    expect(JSON.parse(readFileSync(log, "utf8"))).toEqual(["--install-extension", "spink-dev.whymark"]);
    writeFileSync(log, "unchanged");
    installExtension({ packageRoot: root, code, dryRun: true });
    expect(readFileSync(log, "utf8")).toBe("unchanged");
    expect(() => installExtension({ packageRoot: root, code: join(root, "missing") })).toThrow("CLI not found");
    writeFileSync(code, "#!/usr/bin/env node\nprocess.exit(7);\n", { mode: 0o755 });
    expect(() => installExtension({ packageRoot: root, code })).toThrow("failed (7)");
    writeFileSync(join(root, "dist/whymark-vscode.vsix"), "corrupt");
    expect(() => installExtension({ packageRoot: root, code })).toThrow("checksum mismatch");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
