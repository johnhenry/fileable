/**
 * Core descriptor tree types shared by every pipeline stage (Build -> Resolve ->
 * Layout -> Hash -> Write). See PRD SS2-4.
 */

export const FRAGMENT: unique symbol = Symbol.for("fileable.fragment");

export type StructuralTag = "dir" | "file" | "rm";

export interface BaseProps {
  [key: string]: unknown;
  children?: unknown;
}

export interface DirProps extends BaseProps {
  name?: string;
  from?: string | Promise<string[]> | string[];
  as?: "loose" | "archive";
  mode?: string;
}

export interface FileProps extends BaseProps {
  name?: string;
  src?: string | Promise<string>;
  doctype?: string;
  mode?: string;
  symlink?: Descriptor | string;
  cmd?: string;
  join?: "concat" | "dom-merge";
  /**
   * What to do when Write is about to touch a path that already has
   * content on disk from *outside* this build (not something the current
   * tree already accounted for -- an unchanged, cache-skipped file never
   * reaches this check at all). Default: "replace" (today's behavior,
   * unconditional overwrite).
   *  - "append": adds new content after what's already there.
   *  - "prepend": append's mirror -- new content goes before it instead.
   *  - "skip": leaves the existing file completely untouched (not even
   *    mode/chmod) and continues the rest of the build -- for scaffolding
   *    that shouldn't clobber a file the user may have already customized,
   *    but also shouldn't fail the whole build over that one file.
   *  - "error": refuses to touch it and fails the build.
   * Loose target only -- an archive is always rebuilt as one atomic unit,
   * so there's no meaningful "does this individual entry already exist" to ask.
   */
  onConflict?: "replace" | "append" | "prepend" | "skip" | "error";
}

export interface RmProps extends BaseProps {
  target: string;
}

/** Any tag that isn't one of the three structural primitives is plain markup. */
export type Tag = StructuralTag | typeof FRAGMENT | string;

export interface Descriptor {
  tag: Tag;
  props: Record<string, unknown>;
  children: DescriptorChild[];
  /** Assigned by the Build stage; stable identity for linkTo()/symlink target lookups. */
  __id?: string;
}

export type DescriptorChild =
  | Descriptor
  | LinkRef
  | string
  | number
  | boolean
  | null
  | undefined
  | DescriptorChild[];

export function isDescriptor(value: unknown): value is Descriptor {
  return (
    !!value &&
    typeof value === "object" &&
    "tag" in (value as object) &&
    "props" in (value as object) &&
    "children" in (value as object)
  );
}

export interface LinkOptions {
  format?: "html" | "markdown";
  text?: string;
}

/**
 * linkTo() cannot resolve its target synchronously (Layout, which owns the path
 * table, runs after Build/Resolve). It returns this marker instead; Layout
 * substitutes every LinkRef with its final string once paths are known. The
 * public linkTo() signature still declares `string` (matching the PRD) since the
 * marker only ever flows into JSX prop/content positions, never string methods.
 */
export interface LinkRef {
  readonly __fileableRef: "link";
  target: Descriptor | string;
  options?: LinkOptions;
}

export function isLinkRef(value: unknown): value is LinkRef {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { __fileableRef?: string }).__fileableRef === "link"
  );
}

/** Shared by Build (rejecting an unresolved Promise as JSX content) and Resolve (props). */
export function isThenable(value: unknown): value is Promise<unknown> {
  return !!value && typeof value === "object" && typeof (value as Promise<unknown>).then === "function";
}

/**
 * Deep-clones a descriptor/LinkRef/array structure, preserving internal
 * identity relationships (two references to the same original object
 * within one call clone to the same new object) while producing an
 * entirely fresh graph shared with nothing else. Opaque values (Promises,
 * strings, plain data) pass through by reference untouched.
 *
 * Needed because `resolve.ts` imports a `src="partial.js"` module's default
 * export via `import()`, which Node's module cache memoizes -- two separate
 * `<file src="same/path.js">` occurrences would otherwise splice the exact
 * same object instance into two different places in the tree, violating
 * SS5.4 ("the same JSX element instance must not appear twice") silently
 * whenever that shared content contains a `linkTo()`/nested `<file>` whose
 * resolution depends on which artifact it ends up in.
 */
export function cloneDescriptorTree<T>(root: T): T {
  return cloneNode(root, new WeakMap<object, unknown>()) as T;
}

function cloneNode(value: unknown, memo: WeakMap<object, unknown>): unknown {
  if (value === null || typeof value !== "object") return value;
  const cached = memo.get(value);
  if (cached !== undefined) return cached;

  if (Array.isArray(value)) {
    const cloned: unknown[] = [];
    memo.set(value, cloned);
    for (const item of value) cloned.push(cloneNode(item, memo));
    return cloned;
  }
  if (isDescriptor(value)) {
    const cloned: Descriptor = { tag: value.tag, props: {}, children: [] };
    memo.set(value, cloned);
    for (const [key, propValue] of Object.entries(value.props)) {
      cloned.props[key] = cloneNode(propValue, memo);
    }
    cloned.children = value.children.map((child) => cloneNode(child, memo)) as DescriptorChild[];
    // __id intentionally omitted -- the Build stage assigns a fresh one.
    return cloned;
  }
  if (isLinkRef(value)) {
    const cloned: LinkRef = { __fileableRef: "link", target: value.target, options: value.options };
    memo.set(value, cloned);
    cloned.target = cloneNode(value.target, memo) as Descriptor | string;
    return cloned;
  }
  return value; // opaque (Promise, Date, custom object, ...) -- keep by reference
}

export interface RenderOptions {
  /** Base directory loose/archive artifacts are written into. Default: cwd. */
  outDir?: string;
  /** Base directory used to resolve relative `src` paths. Default: outDir. */
  cwd?: string;
  /** Required to allow the `cmd` attribute to execute a shell command (SS7.1). */
  allowExec?: boolean;
  /** Promote symlink-fallback warnings (SS5.3) to hard errors. */
  strict?: boolean;
  /** Path to the incremental-build lock file. Default: <outDir>/.fileable-lock.json */
  lockFile?: string;
  /** Set false to force a full rewrite, ignoring the lock file. Default: true. */
  cache?: boolean;
  /**
   * Run the full pipeline (through Hash) and report what *would* be
   * written/skipped/removed, without touching disk at all -- not even the
   * lock file. The Docker-idioms framing (SS1.1) this project uses
   * elsewhere maps onto `plan` vs. `apply`; this is the `plan` side, which
   * didn't otherwise exist. Default: false.
   */
  dryRun?: boolean;
}

/**
 * "inline" (a single concatenated file, PRD SS5.2) isn't a distinct writer --
 * nesting a <dir> inside a <file> already produces exactly one real <file>
 * artifact via nameless inlining (SS5.1), written by whichever writer
 * (loose/archive) its enclosing context uses.
 */
export type RenderTarget = "loose" | "archive";

/** A real, addressable output artifact (a loose file/dir, an archive, or an inlined file). */
export interface ArtifactNode {
  id: string;
  kind: "file" | "dir";
  descriptor: Descriptor;
  /** Path relative to outDir (loose), relative to the archive root (archive), or self (inline). */
  outputPath: string;
  target: RenderTarget;
  /** For target === "archive": the .zip file's own outputPath. */
  archivePath?: string;
  /** A `Buffer` for binary content (see content-util.ts); plain text stays a `string`. */
  content?: string | Buffer;
  mode?: string;
  /** Resolved relative target for a real symlink (loose target only). */
  symlinkTo?: string;
  /** True if a requested symlink degraded to a copy (SS5.3). */
  symlinkDegraded?: boolean;
  children: string[];
}

export interface LayoutResult {
  artifacts: ArtifactNode[];
  byId: Map<string, ArtifactNode>;
  removals: string[];
  warnings: string[];
}

export interface HashedArtifact extends ArtifactNode {
  hash: string;
  dependsOn: string[];
}

export interface HashResult {
  artifacts: HashedArtifact[];
  byId: Map<string, HashedArtifact>;
  removals: string[];
  warnings: string[];
}

export interface LockFileShape {
  version: 1;
  /** Recorded so a bare hex digest never quietly represents a different policy across releases. */
  algorithm: string;
  /** Keyed by ArtifactNode.id, not outputPath -- outputPath alone collides across sibling archives. */
  artifacts: Record<string, { hash: string; dependsOn: string[] }>;
}

export interface WriteSummary {
  written: string[];
  skipped: string[];
  removed: string[];
  warnings: string[];
}

export class FileableError extends Error {
  path: string;
  constructor(message: string, path: string, cause?: unknown) {
    super(`${message} (at ${path})`);
    this.name = "FileableError";
    this.path = path;
    if (cause !== undefined) {
      (this as { cause?: unknown }).cause = cause;
    }
  }
}
