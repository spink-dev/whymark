import { parentPort, workerData } from "node:worker_threads";
import { buildSkeleton, repoRoot } from "../../../src/lib/whymark/git";
import { serializeWhymark } from "../../../src/lib/whymark/serialize";
try {
  const root = repoRoot(workerData.cwd);
  if (!root) throw new Error("Choose a folder inside a Git repository.");
  const { doc } = buildSkeleton({ ...workerData, cwd: root, author: "Unreviewed Git comparison" });
  parentPort?.postMessage({ text: serializeWhymark(doc), root });
} catch (error) { parentPort?.postMessage({ error: String(error) }); }
