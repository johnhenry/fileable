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
): Promise<string[]> {
  const written: string[] = [];
  const archiveRoots = artifacts.filter(
    (a) => a.target === "archive" && a.archivePath === a.outputPath && dirtyRootIds.has(a.id),
  );

  for (const root of archiveRoots) {
    const entries: Record<string, Uint8Array> = {};
    for (const artifact of artifacts) {
      if (artifact.archivePath !== root.archivePath || artifact === root) continue;
      if (artifact.kind === "dir") {
        entries[`${artifact.outputPath}/`] = new Uint8Array(0);
      } else {
        entries[artifact.outputPath] = strToU8(artifact.content ?? "");
      }
    }
    const zipped = zipSync(entries);
    const fullPath = join(outDir, root.archivePath!);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, zipped);
    written.push(root.archivePath!);
  }

  return written;
}
