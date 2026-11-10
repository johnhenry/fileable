/**
 * Zip writer (PRD SS5.2 `encode="zip"`): materializes a subtree as a `.zip`
 * containing the same tree, using `fflate` (pure JS, no native deps).
 */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import type { HashedArtifact } from "../types.js";
import { assertSafeEntryName } from "./entry-name.js";
import { OutDirGuard } from "./contain.js";

export async function writeZips(
  artifacts: HashedArtifact[],
  outDir: string,
  dirtyRootIds: Set<string>,
  dryRun = false,
  guard: OutDirGuard = new OutDirGuard(outDir, dryRun),
): Promise<string[]> {
  const written: string[] = [];
  const zipRoots = artifacts.filter(
    (a) => a.target === "zip" && a.containerPath === a.outputPath && dirtyRootIds.has(a.id),
  );

  for (const root of zipRoots) {
    const members = artifacts.filter((a) => a.containerPath === root.containerPath && a !== root);
    for (const artifact of members) assertSafeEntryName(artifact.outputPath, "zip", root.containerPath!);
    if (!dryRun) {
      const entries: Record<string, Uint8Array> = {};
      for (const artifact of members) {
        if (artifact.kind === "dir") {
          entries[`${artifact.outputPath}/`] = new Uint8Array(0);
        } else {
          // A Buffer (binary content -- SS2.2) is already raw bytes and a
          // Node Buffer *is* a Uint8Array, so it's used as-is; only a
          // string needs strToU8's UTF-8 encoding.
          entries[artifact.outputPath] =
            typeof artifact.content === "string" ? strToU8(artifact.content) : artifact.content ?? new Uint8Array(0);
        }
      }
      const zipped = zipSync(entries);
      const fullPath = join(outDir, root.containerPath!);
      await guard.prepareReplace(fullPath);
      await writeFile(fullPath, zipped);
    }
    written.push(root.containerPath!);
  }

  return written;
}
