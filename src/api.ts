/**
 * Runtime API (PRD SS6, originally named link()): linkTo(), warn(), glob(),
 * useCollection(). No `<collection>` tag -- cross-file data access is plain
 * JS values.
 */
import { recordCollectionDependency, recordWarning } from "./context.js";
import { toPosixPattern } from "./glob-util.js";
import type { Descriptor, LinkOptions } from "./types.js";
import type { globSync as GlobSyncFn } from "glob";

/**
 * Loads `glob`'s `globSync` lazily, at call time rather than module load
 * time (issue #8): a static `import { globSync } from "glob"` here ran
 * unconditionally the instant this module was loaded, which dragged `glob`
 * -> `node:events` (and friends) into any bundle that imported so much as
 * `linkTo()`/`warn()` from this same file -- even though neither of them
 * touches `glob` at all.
 *
 * `process.getBuiltinModule("node:module")` + `createRequire(...)("glob")`
 * is a plain runtime call -- `"node:module"`/`"glob"` only ever appear as
 * ordinary strings, never as a static `import`/`require()` specifier a
 * bundler's resolver can see. That distinction matters, and was checked
 * against a real `esbuild --platform=browser --bundle` run rather than
 * assumed: a top-level `import { globSync } from "glob"` fails to resolve
 * `node:events`/`node:fs`/etc regardless of whether `globSync` itself ends
 * up used; swapping it for `await import("glob")` nested inside a function
 * *still* fails the same way, because esbuild eagerly resolves a dynamic
 * `import()`'s target for code-splitting purposes even when the enclosing
 * function is never called. This lookup, by contrast, bundles clean in
 * both the tree-shaken-away case (a browser bundle that never references
 * `useCollection()`/`glob()` at all) and the retained-but-never-called
 * case (one that imports them but never runs them in a browser) --
 * verified by bundling both shapes for real, not just reasoning about it.
 */
function loadGlobSync(): typeof GlobSyncFn {
  const { createRequire } = process.getBuiltinModule("node:module");
  return createRequire(import.meta.url)("glob").globSync;
}

/**
 * Returns a LinkRef marker, not a literal string -- Layout resolves it once
 * the path table is complete (see the design note in src/layout.ts). The
 * public signature still declares `string` to match PRD SS6.1 (which names
 * this `link()`; renamed here to say what it actually computes -- a
 * reference *to* another node) and because the marker only ever flows into
 * JSX prop/content positions.
 */
export function linkTo(target: Descriptor | string, options?: LinkOptions): string {
  return { __fileableRef: "link", target, options } as unknown as string;
}

export function warn(message: string): void {
  recordWarning(message);
}

/** One-off, non-cached glob expansion -- no dependency tracking. */
export function glob(pattern: string): string[] {
  return loadGlobSync()(toPosixPattern(pattern));
}

/**
 * Same shape as glob(), but registers a dependency edge so Stage 4 (Hash)
 * invalidates builds when a matched source file changes. Use this over
 * glob() when the result feeds cache-sensitive output.
 */
export function useCollection(pattern: string): string[] {
  recordCollectionDependency(pattern);
  return loadGlobSync()(toPosixPattern(pattern));
}
