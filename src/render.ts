/**
 * render(): runs the full five-stage pipeline (PRD SS4) end to end and
 * performs Stage 5 (Write).
 */
import { join } from "node:path";
import { build } from "./build.js";
import { resolve } from "./resolve.js";
import { layout } from "./layout.js";
import { hash } from "./hash.js";
import { readLockFile, writeLockFile, isUnchanged } from "./lock.js";
import { applyRemovals, writeLoose } from "./write/loose.js";
import { writeArchives } from "./write/archive.js";
import { drainBuildContext } from "./context.js";
import type { RenderOptions, WriteSummary } from "./types.js";

export async function render(tree: unknown, options: RenderOptions = {}): Promise<WriteSummary> {
  const outDir = options.outDir ?? process.cwd();
  const lockPath = options.lockFile ?? join(outDir, ".fileable-lock.json");
  const useCache = options.cache ?? true;

  const builtRoots = build(tree);
  const resolvedRoots = await resolve(builtRoots, options);
  const laidOut = layout(resolvedRoots, options);
  const { collectionPatterns, warnings: contextWarnings } = drainBuildContext();
  const hashed = hash(laidOut, collectionPatterns);

  const lock = useCache ? await readLockFile(lockPath) : undefined;

  const looseChanged = hashed.artifacts.filter((a) => a.target === "loose" && !isUnchanged(a, lock));
  const looseSkipped = hashed.artifacts
    .filter((a) => a.target === "loose" && isUnchanged(a, lock))
    .map((a) => a.outputPath);

  const archiveRoots = hashed.artifacts.filter((a) => a.target === "archive" && a.archivePath === a.outputPath);
  const dirtyRootIds = new Set(archiveRoots.filter((root) => !isUnchanged(root, lock)).map((r) => r.id));
  const archiveSkipped = archiveRoots.filter((r) => !dirtyRootIds.has(r.id)).map((r) => r.outputPath);

  const dryRun = !!options.dryRun;
  const removed = await applyRemovals(hashed.removals, outDir, dryRun);
  const looseResult = await writeLoose(looseChanged, outDir, !!options.strict, dryRun);
  const archiveWritten = await writeArchives(hashed.artifacts, outDir, dirtyRootIds, dryRun);

  if (!dryRun) await writeLockFile(lockPath, hashed.artifacts);

  const allWarnings = [...hashed.warnings, ...contextWarnings, ...looseResult.warnings];
  for (const message of allWarnings) {
    console.warn(`fileable: warning: ${message}`);
  }

  return {
    written: [...looseResult.written, ...archiveWritten],
    skipped: [...looseSkipped, ...archiveSkipped, ...looseResult.skipped],
    removed,
    warnings: allWarnings,
  };
}
