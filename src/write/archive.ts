/**
 * Archive writer (PRD SS5.2 `as="archive"`): materializes a subtree as a
 * `.zip` containing the same tree, using `fflate` (pure JS, no native deps).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { strToU8, zipSync } from "fflate";
import type { HashedArtifact } from "../types.js";

export async function writeArchives(
  artifacts: HashedArtifact[],
  outDir: string,
  dirtyRootIds: Set<string>,
  dryRun = false,
): Promise<string[]> {
  const written: string[] = [];
  const archiveRoots = artifacts.filter(
    (a) => a.target === "archive" && a.archivePath === a.outputPath && dirtyRootIds.has(a.id),
  );

  for (const root of archiveRoots) {
    if (!dryRun) {
      const entries: Record<string, Uint8Array> = {};
      for (const artifact of artifacts) {
        if (artifact.archivePath !== root.archivePath || artifact === root) continue;
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
      const fullPath = join(outDir, root.archivePath!);
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, zipped);
    }
    written.push(root.archivePath!);
  }

  return written;
}
