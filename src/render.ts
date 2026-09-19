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
import { applyRemovals, pathExists, writeLoose } from "./write/loose.js";
import { writeArchives } from "./write/archive.js";
import { drainBuildContext } from "./context.js";
import { cloneDescriptorTree } from "./types.js";
import type { RenderOptions, WriteSummary } from "./types.js";

export async function render(tree: unknown, options: RenderOptions = {}): Promise<WriteSummary> {
  const outDir = options.outDir ?? process.cwd();
  const lockPath = options.lockFile ?? join(outDir, ".fileable-lock.json");
  const useCache = options.cache ?? true;

  // Build/Resolve mutate descriptor nodes in place (assigning __id, folding
  // resolved src/cmd content into props, splicing in <dir from> matches) --
  // cloning up front means calling render() twice on the exact same tree
  // object (a natural SDK pattern: build a tree once, render it under
  // different options) can never leak one call's mutations into the next.
  const builtRoots = build(cloneDescriptorTree(tree));
  const resolvedRoots = await resolve(builtRoots, options);
  const laidOut = layout(resolvedRoots, options);
  const { collectionPatterns, warnings: contextWarnings } = drainBuildContext();
  const hashed = hash(laidOut, collectionPatterns);

  const lock = useCache ? await readLockFile(lockPath) : undefined;

  // A matching hash alone isn't enough to skip a write -- the lock file only
  // records what was *built*, not what's still actually there. Someone
  // deleting a build output by hand (or a half-finished previous run) would
  // otherwise leave "unchanged" artifacts permanently missing, since nothing
  // else ever re-checks disk once the hash says "nothing to do".
  const looseCandidates = hashed.artifacts.filter((a) => a.target === "loose");
  const looseChanged = looseCandidates.filter((a) => !isUnchanged(a, lock));
  const looseSkipped: string[] = [];
  for (const artifact of looseCandidates) {
    if (!isUnchanged(artifact, lock)) continue;
    if (await pathExists(join(outDir, artifact.outputPath))) {
      looseSkipped.push(artifact.outputPath);
    } else {
      looseChanged.push(artifact);
    }
  }

  const archiveRoots = hashed.artifacts.filter((a) => a.target === "archive" && a.archivePath === a.outputPath);
  const dirtyRootIds = new Set(archiveRoots.filter((root) => !isUnchanged(root, lock)).map((r) => r.id));
  const archiveSkipped: string[] = [];
  for (const root of archiveRoots) {
    if (dirtyRootIds.has(root.id)) continue;
    if (await pathExists(join(outDir, root.outputPath))) {
      archiveSkipped.push(root.outputPath);
    } else {
      dirtyRootIds.add(root.id);
    }
  }

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
