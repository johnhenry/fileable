/**
 * Runtime API (PRD SS6): link(), warn(), glob(), useCollection(). No
 * `<collection>` tag -- cross-file data access is plain JS values.
 */
import { globSync } from "glob";
import { recordCollectionDependency, recordWarning } from "./context.js";
import { toPosixPattern } from "./glob-util.js";
import type { Descriptor, LinkOptions } from "./types.js";

/**
 * Returns a LinkRef marker, not a literal string -- Layout resolves it once
 * the path table is complete (see the design note in src/layout.ts). The
 * public signature still declares `string` to match PRD SS6.1 and because
 * the marker only ever flows into JSX prop/content positions.
 */
export function link(target: Descriptor | string, options?: LinkOptions): string {
  return { __fileableRef: "link", target, options } as unknown as string;
}

export function warn(message: string): void {
  recordWarning(message);
}

/** One-off, non-cached glob expansion -- no dependency tracking. */
export function glob(pattern: string): string[] {
  return globSync(toPosixPattern(pattern));
}

/**
 * Same shape as glob(), but registers a dependency edge so Stage 4 (Hash)
 * invalidates builds when a matched source file changes. Use this over
 * glob() when the result feeds cache-sensitive output.
 */
export function useCollection(pattern: string): string[] {
  recordCollectionDependency(pattern);
  return globSync(toPosixPattern(pattern));
}
