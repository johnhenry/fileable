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
  /** Assigned by the Build stage; stable identity for link()/symlink target lookups. */
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
 * link() cannot resolve its target synchronously (Layout, which owns the path
 * table, runs after Build/Resolve). It returns this marker instead; Layout
 * substitutes every LinkRef with its final string once paths are known. The
 * public link() signature still declares `string` (matching the PRD) since the
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
  content?: string;
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
