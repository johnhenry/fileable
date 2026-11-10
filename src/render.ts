/**
 * render(): runs the full five-stage pipeline (PRD SS4) end to end and
 * performs Stage 5 (Write).
 */
import { createHash } from "node:crypto";
import { join, resolve as resolvePath } from "node:path";
import { build } from "./build.js";
import { resolve } from "./resolve.js";
import { layout } from "./layout.js";
import { hash } from "./hash.js";
import { readLockFile, writeLockFile, isUnchanged } from "./lock.js";
import { applyRemovals, pathExists, writeLoose } from "./write/loose.js";
import { writeZips } from "./write/zip.js";
import { writeWbn } from "./write/wbn.js";
import { OutDirGuard } from "./write/contain.js";
import { IO_CONCURRENCY, mapLimit } from "./concurrency.js";
import { drainBuildContext } from "./context.js";
import { assertPermitted, permissionModel } from "./errors.js";
import { cloneDescriptorTree, FileableError } from "./types.js";
import type { Descriptor, FileableWarning, HashedArtifact, OutputEntry, RenderOptions, WarningCode, WriteSummary } from "./types.js";

export async function render(tree: unknown, options: RenderOptions = {}): Promise<WriteSummary> {
  const outDir = options.outDir ?? process.cwd();
  const lockPath = options.lockFile ?? join(outDir, ".fileable-lock.json");
  const useCache = options.cache ?? true;

  // Build/Resolve mutate descriptor nodes in place (assigning __id, folding
  // resolved src/cmd content into props, splicing in <dir from> matches) --
  // cloning up front means calling render() twice on the exact same tree
  // object (a natural SDK pattern: build a tree once, render it under
  // different options) can never leak one call's mutations into the next.
  // Keeping writes inside outDir means looking at what's already there
  // (lstat/realpath, #31), so under `node --permission` outDir needs read as
  // well as write. Say so before any work starts.
  assertPermitted("fs.read", resolvePath(outDir), "fileable checks outDir for symlinks before writing into it");
  const builtRoots = build(cloneDescriptorTree(tree));
  applyDefaultEncode(builtRoots, options.encode);
  const resolvedRoots = await resolve(builtRoots, options);
  const laidOut = layout(resolvedRoots, options);
  const { collectionPatterns, warnings: contextWarnings } = drainBuildContext();
  const hashed = hash(laidOut, collectionPatterns);

  const lock = useCache ? await readLockFile(lockPath) : undefined;
  // Under `node --permission`, --allow-fs-write doesn't imply read access:
  // without --allow-fs-read for the lock file, every build silently became a
  // full rebuild. Say so (#25).
  const cacheWarnings: string[] = [];
  const permission = permissionModel();
  if (useCache && permission && !permission.has("fs.read", lockPath)) {
    cacheWarnings.push(
      `the lock file ${lockPath} isn't readable under Node's permission model, so every build is a full rebuild -- ` +
        "add --allow-fs-read for the output directory to keep the incremental cache",
    );
  }

  // A matching hash alone isn't enough to skip a write -- the lock file only
  // records what was *built*, not what's still actually there. Someone
  // deleting a build output by hand (or a half-finished previous run) would
  // otherwise leave "unchanged" artifacts permanently missing, since nothing
  // else ever re-checks disk once the hash says "nothing to do".
  const looseCandidates = hashed.artifacts.filter((a) => a.target === "loose");
  const looseChanged = looseCandidates.filter((a) => !isUnchanged(a, lock));
  // Existence checks run IO_CONCURRENCY at a time (issue #22); results are
  // consumed in artifact order, so both lists keep their sequential order.
  const looseSkipped: string[] = [];
  const looseUnchanged = looseCandidates.filter((a) => isUnchanged(a, lock));
  const looseExists = await mapLimit(looseUnchanged, IO_CONCURRENCY, (a) => pathExists(join(outDir, a.outputPath)));
  looseUnchanged.forEach((artifact, i) => {
    if (looseExists[i]) looseSkipped.push(artifact.outputPath);
    else looseChanged.push(artifact);
  });

  const containerRoots = hashed.artifacts.filter(
    (a) => (a.target === "zip" || a.target === "wbn") && a.containerPath === a.outputPath,
  );
  const dirtyRootIds = new Set(containerRoots.filter((root) => !isUnchanged(root, lock)).map((r) => r.id));
  const containerSkipped: string[] = [];
  const cleanRoots = containerRoots.filter((root) => !dirtyRootIds.has(root.id));
  const rootExists = await mapLimit(cleanRoots, IO_CONCURRENCY, (r) => pathExists(join(outDir, r.outputPath)));
  cleanRoots.forEach((root, i) => {
    if (rootExists[i]) containerSkipped.push(root.outputPath);
    else dirtyRootIds.add(root.id);
  });

  const dryRun = !!options.dryRun;
  // One guard for the whole write stage (#31): every directory it creates is
  // checked once, and every write stays inside outDir.
  const guard = new OutDirGuard(outDir, dryRun);
  const removeResult = await applyRemovals(hashed.removals, outDir, dryRun, guard);
  const looseResult = await writeLoose(looseChanged, outDir, !!options.strict, dryRun, guard);
  const zipWritten = await writeZips(hashed.artifacts, outDir, dirtyRootIds, dryRun, guard);
  const wbnWritten = await writeWbn(hashed.artifacts, outDir, dirtyRootIds, dryRun, guard);

  if (!dryRun) {
    // The default lock file lives in outDir: replace a link there rather
    // than writing through it. A lockFile path you chose is used as given.
    if (options.lockFile === undefined) await guard.prepareReplace(lockPath);
    await writeLockFile(lockPath, hashed.artifacts);
  }

  const coded = (code: WarningCode, messages: string[]): FileableWarning[] => messages.map((message) => ({ code, message }));
  const warningDetails: FileableWarning[] = [
    ...coded("E_SYMLINK_FALLBACK", hashed.warnings),
    ...coded("E_WARN", contextWarnings),
    ...coded("E_RM_NO_MATCH", removeResult.warnings),
    ...coded("E_SYMLINK_FALLBACK", looseResult.warnings),
    ...coded("E_CACHE_UNREADABLE", cacheWarnings),
  ];
  for (const warning of warningDetails) {
    if (options.onWarning) options.onWarning(warning);
    else console.warn(`fileable: warning: ${warning.message}`);
  }

  const written = [...looseResult.written, ...zipWritten, ...wbnWritten];
  const unchanged = [...looseSkipped, ...containerSkipped];
  return {
    written,
    skipped: [...unchanged, ...looseResult.skipped],
    removed: removeResult.removed,
    warnings: warningDetails.map((w) => w.message),
    warningDetails,
    outputs: describeOutputs(hashed.artifacts, written, unchanged, looseResult.skipped),
    buildHash: buildHashOf(hashed.artifacts),
  };
}

/** Real on-disk outputs only: loose artifacts and archive roots, not entries inside an archive. */
function describeOutputs(
  artifacts: HashedArtifact[],
  written: string[],
  unchanged: string[],
  skipped: string[],
): OutputEntry[] {
  const childIds = new Set(artifacts.flatMap((a) => a.children));
  const onDisk = new Map<string, HashedArtifact>();
  for (const a of artifacts) {
    if (a.target === "loose" || a.containerPath === a.outputPath) onDisk.set(a.outputPath, a);
  }
  const entries: OutputEntry[] = [];
  const add = (paths: string[], action: OutputEntry["action"]) => {
    for (const path of paths) {
      const a = onDisk.get(path);
      if (!a) continue;
      entries.push({ path, action, kind: a.target === "loose" ? a.kind : "file", encode: a.target, hash: a.hash, root: !childIds.has(a.id) });
    }
  };
  add(written, "written");
  add(unchanged, "unchanged");
  add(skipped, "skipped");
  return entries;
}

function buildHashOf(artifacts: HashedArtifact[]): string {
  const lines = artifacts.map((a) => `${a.id}\0${a.hash}`).sort();
  return createHash("sha256").update(lines.join("\n")).digest("hex");
}

function applyDefaultEncode(roots: Descriptor[], encode: RenderOptions["encode"]): void {
  if (encode === undefined) return;
  if (encode !== "loose" && encode !== "zip" && encode !== "wbn") {
    throw new FileableError(`invalid encode option "${String(encode)}" -- expected "loose", "zip", or "wbn"`, "<render options>", undefined, "E_INVALID_OPTION");
  }
  for (const root of roots) {
    if (root.tag === "dir") {
      if (root.props.encode === undefined) root.props.encode = encode;
    } else if (encode !== "loose" && root.tag !== "rm") {
      throw new FileableError(
        `encode option "${encode}" applies to root <Dir>s, but this root is a <${String(root.tag)}> -- wrap it in a <Dir>`,
        `<${String(root.tag)}>`,
        undefined,
        "E_INVALID_OPTION",
      );
    }
  }
}
