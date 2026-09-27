/**
 * `@johnhenry/fileable/browser` (issue #6): a browser-safe entry point
 * covering the four stages of the pipeline that don't inherently need a
 * real filesystem -- Build -> Resolve -> Layout -> Hash -- stopping there
 * instead of proceeding to Stage 5 (Write), which genuinely does. Useful
 * for previews, scaffolding UIs, and tests that need to know what a
 * fileable tree *would* produce without ever touching disk (the
 * `render(tree, { dryRun: true })` idea, PRD's Docker `plan`/`apply`
 * framing, minus the Node-only parts).
 *
 * Why the main entry point (`@johnhenry/fileable`) can't just be used for
 * this: `resolve.ts` imports `node:fs/promises`/`node:zlib`/`node:url` (for
 * local `src=` reads, `<Dir src decode>`, compiled-module `src=` imports),
 * `layout.ts` imported `node:path/posix` (now `../posix-path.ts` instead,
 * shared by both entry points), and `hash.ts` imports `node:crypto`. A
 * bundler targeting the browser (Vite, esbuild with `platform: "browser"`)
 * either hard-fails to resolve those or silently replaces them with empty
 * modules, which turns real, unconditionally-executed calls
 * (`posixPath.join(...)`, `createHash(...)`) into runtime crashes even for
 * a tree that never uses `src=`/`cmd` at all.
 *
 * This module's own graph (`./resolve.js`, `../layout.js` ->
 * `../posix-path.js`, `./hash.js`, `../build.js`, `../types.js`) has zero
 * `node:*` imports anywhere in it -- verified by actually bundling a
 * scratch app with Vite/esbuild `platform: "browser"` and running it in a
 * simulated browser environment (see this repo's verification notes for
 * issue #6).
 *
 * What's NOT supported here (see ./resolve.ts's own doc comment for the
 * full list and why): local filesystem `src=` paths, compiled-module
 * `src=` imports, `<Dir from="glob">`, `<Dir src decode>`, `cmd`, and
 * `env://` -- all of which need real Node/OS access with no browser
 * equivalent, and throw a clear `FileableError` pointing back at the Node
 * entry point rather than silently no-op'ing.
 *
 * `glob()`/`useCollection()` (../api.ts) are also NOT re-exported here --
 * both genuinely need the real `glob` npm package (itself `node:fs`-backed,
 * no browser equivalent) and would throw immediately if called from a
 * browser anyway. `linkTo()`/`warn()` (../api.ts) and `markdownToHtml()`
 * (../markdown.ts), by contrast, don't touch `glob`/`node:fs`/anything
 * else Node-only at all -- they were only unreachable from this entry
 * point because `api.ts` used to import `glob` at module load time
 * (issue #8), which drags `glob` -> `node:events` into a bundle the moment
 * anything from `api.ts` is imported, regardless of which export is
 * actually used. `api.ts` now loads `glob` lazily (inside `glob()`/
 * `useCollection()` themselves, via a runtime `process.getBuiltinModule`
 * lookup a bundler's static resolver can't see -- see api.ts's own doc
 * comment), so `linkTo`/`warn` are safe to import from `api.ts` even in a
 * browser bundle; `drainBuildContext()` (../context.ts) never had a
 * Node-only import problem at all, just the same "only reachable by file
 * path, not from `./browser`" gap. All four are re-exported below.
 * Verified for real: bundling a scratch entry that imports exactly these
 * four (plus `plan`) from `@johnhenry/fileable/browser` with both
 * `esbuild --platform=browser --bundle` and `vite build` against the
 * packed package produces zero `node:*` specifiers in the output.
 */
import { build } from "../build.js";
import { layout } from "../layout.js";
import { cloneDescriptorTree } from "../types.js";
import type { Descriptor, HashedArtifact, LockFileShape, RemovalSpec, RenderOptions } from "../types.js";
import { resolve } from "./resolve.js";
import { hash, HASH_ALGORITHM } from "./hash.js";

export { build } from "../build.js";
export { layout } from "../layout.js";
export { resolve } from "./resolve.js";
export { hash, HASH_ALGORITHM } from "./hash.js";
export { linkTo, warn } from "../api.js";
export { markdownToHtml } from "../markdown.js";
export { drainBuildContext } from "../context.js";
// `File`/`Dir`/`Rm` (../components.ts) only ever build a plain descriptor
// object from `FILEABLE_DESCRIPTOR`/types.ts -- zero `node:*` imports, same
// as `../jsx-runtime.js`/`../jsx-dev-runtime.js` (already their own
// existing, separately-exported subpaths) -- so real JSX authored against
// `@johnhenry/fileable/jsx-runtime` (`<Dir>`/`<File>` resolve to these) can
// be built, planned, and previewed entirely from browser-safe subpaths,
// with no dependency on the Node-only main entry point at all.
export { File, Dir, Rm } from "../components.js";
export type {
  ArtifactNode,
  Descriptor,
  DescriptorChild,
  HashedArtifact,
  HashResult,
  LayoutResult,
  LockFileShape,
  RemovalSpec,
  RenderOptions,
} from "../types.js";
export { FileableError } from "../types.js";

/** Per-artifact status relative to `previousLock`, the same three states a real Write would report (PRD SS8's incremental-build cache). */
export type PlanStatus = "new" | "changed" | "cached";

export interface PlannedArtifact extends HashedArtifact {
  status: PlanStatus;
}

export interface PlanResult {
  /** Every artifact the tree resolves to, each hashed and classified against `previousLock` -- nothing has been written. */
  artifacts: PlannedArtifact[];
  /** `<Rm>` targets this tree would remove -- also unexecuted (Stage 5 territory). */
  removals: RemovalSpec[];
  warnings: string[];
}

function classify(artifact: HashedArtifact, previousLock: LockFileShape | undefined): PlanStatus {
  if (!previousLock || previousLock.algorithm !== HASH_ALGORITHM) return "new";
  const previous = previousLock.artifacts[artifact.id];
  if (previous === undefined) return "new";
  return previous.hash === artifact.hash ? "cached" : "changed";
}

/**
 * Runs Build -> Resolve -> Layout -> Hash for real (identical algorithms to
 * the Node entry point's `render()`, up through Hash) and returns the
 * resulting plan -- what *would* be written -- without writing anything,
 * not even a lock file (there's no filesystem to write one to here; pass a
 * previously-obtained `PlanResult`'s artifacts, reshaped into a
 * `LockFileShape`, as `previousLock` to get real new/changed/cached
 * status across calls).
 */
export async function plan(tree: unknown, options: RenderOptions = {}, previousLock?: LockFileShape): Promise<PlanResult> {
  const builtRoots: Descriptor[] = build(cloneDescriptorTree(tree));
  const resolvedRoots = await resolve(builtRoots, options);
  const laidOut = layout(resolvedRoots, options);
  const hashed = await hash(laidOut, []);

  const artifacts: PlannedArtifact[] = hashed.artifacts.map((artifact) => ({
    ...artifact,
    status: classify(artifact, previousLock),
  }));

  return { artifacts, removals: hashed.removals, warnings: hashed.warnings };
}

/** Builds a `LockFileShape` from a prior `plan()` call's artifacts, so its `status` can be diffed against on the next call (e.g. round-tripped through `localStorage`/`IndexedDB`). */
export function toLockFileShape(artifacts: HashedArtifact[]): LockFileShape {
  const lock: LockFileShape = { version: 1, algorithm: HASH_ALGORITHM, artifacts: {} };
  for (const artifact of artifacts) {
    lock.artifacts[artifact.id] = { hash: artifact.hash, dependsOn: artifact.dependsOn };
  }
  return lock;
}
