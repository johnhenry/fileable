/**
 * Core descriptor tree types shared by every pipeline stage (Build -> Resolve ->
 * Layout -> Hash -> Write). See PRD SS2-4.
 */

export const FRAGMENT: unique symbol = Symbol.for("fileable.fragment");

/**
 * Global-symbol-registry brand every descriptor created by this package's
 * `Dir`/`File`/`Rm`/`jsx()` carries. Other packages (e.g. `servable`, which
 * wants to recognize a fileable tree appearing as a raw JSX child, not just
 * behind a `from=` prop) can check `FILEABLE_DESCRIPTOR in value` directly
 * via `Symbol.for("fileable.descriptor")` -- no import of this package
 * required, since `Symbol.for` resolves to the same symbol from any module
 * that asks for the same string key. This matters for servable specifically
 * because `@johnhenry/fileable` is an *optional* peer dependency there --
 * shape-based duck typing (every Descriptor, from either package, has the
 * identical `{tag,props,children}` shape) can't tell them apart at all once
 * a fileable node might appear anywhere a servable node could.
 */
export const FILEABLE_DESCRIPTOR: unique symbol = Symbol.for("fileable.descriptor");

export type StructuralTag = "dir" | "file" | "rm" | "ipfs" | "markdownhtml";

export interface BaseProps {
  [key: string]: unknown;
  children?: unknown;
}

/**
 * EXAMPLE PRIMITIVE -- demonstrates how cheaply a genuinely new tag can be
 * added on top of the existing pipeline (see README's "Adding a new tag"
 * section for the full walkthrough). `<IPFS name="..." src="ipfs://<cid>/..." />`
 * fetches content from a public IPFS gateway and behaves exactly like a
 * `<File>` from that point on -- `resolve.ts` normalizes an `"ipfs"` node
 * to a `"file"` node once its content is fetched, so `layout.ts`/`hash.ts`/
 * every writer needs zero awareness this tag exists at all. `src` is
 * required (unlike `File`'s optional `src`) -- there's no other way for an
 * `<IPFS>` node to get content, so an author who forgets it should see a
 * clear error immediately rather than a silently empty file.
 */
export interface IPFSProps extends BaseProps {
  name?: string;
  src: string;
}

/**
 * EXAMPLE PRIMITIVE, same trick as `IPFS` above. `<MarkdownHTML
 * name="post.html" src="post.md" />` loads `src` through the exact same
 * `loadSrc()` used for `<File src>` -- local path, `https://`, `ipfs://`,
 * all of it -- then pipes the result through the existing
 * `markdownToHtml()` runtime helper (`markdown.ts`) before normalizing to
 * `"file"`, the same way `IPFS` does. Not a new content-loading mechanism,
 * just `File` + a transform wired in as a real primitive instead of
 * something called manually. Named `MarkdownHTML`, not `Markdown`, so the
 * *output* format is unambiguous from the tag itself -- "Markdown" alone
 * doesn't say what it becomes. `src` is required -- there's no other
 * content source to convert. Any nested JSX children are appended as-is
 * AFTER the converted HTML (same order `File`'s own base64 -> src -> cmd
 * -> children combination already uses) -- they are not themselves run
 * through markdown conversion.
 */
export interface MarkdownHTMLProps extends BaseProps {
  name?: string;
  src: string;
}

export interface DirProps extends BaseProps {
  name?: string;
  from?: string | Promise<string[]> | string[];
  /**
   * Path to an existing archive file to decode into this `<Dir>`'s children
   * -- the inverse of `encode="zip"`/`encode="wbn"`: those go tree ->
   * archive, this goes archive -> tree. Requires `decode` to say which
   * format it is (not
   * sniffed from the extension -- explicit, matching this codebase's
   * fail-loudly convention for `contentMode`/`binaryMode`/etc.). Each entry
   * becomes an ordinary `<File>` child, prepended before any of this
   * `<Dir>`'s own explicit children (same rule `from="glob"` already
   * follows) -- but unlike every other artifact-path collision in this
   * codebase, an explicit child sharing a decoded entry's `name` does NOT
   * throw: it wins, replacing that entry. This is the one place overriding
   * is the point rather than a mistake -- "unpack an existing archive, then
   * change a few files" (the same relationship Docker's `FROM`+`COPY`
   * layering has). Zip directory entries (paths ending in `/`) are skipped;
   * a `.wbn` archive has no such entries at all to skip.
   */
  src?: string;
  decode?: "zip" | "wbn";
  /**
   * How this subtree materializes. `"loose"` (default): real files/
   * directories on disk. `"zip"`: one `.zip` (via `fflate`). `"wbn"`: one
   * `.wbn` file -- gzip(`application/webbundle`), the format Chrome's
   * Isolated Web Apps are built on, via the real `wbn` package directly (no
   * `@johnhenry/packfile` dependency -- that package's own archive format
   * IS this format, so a file produced here is byte-for-byte what its
   * `toArchive()`/`fromArchive()`/`createRouter()` already read and write) --
   * for shipping a whole static site as one importable/servable blob instead
   * of a directory of files. Named after the actual format in each case
   * (`"zip"`/`"wbn"`), not a container/package name -- `"archive"` was too
   * generic (which archive format?) and `"packfile"` named a specific
   * ecosystem package rather than the wire format itself. Named `encode`,
   * not `as`, to read as the direct counterpart of `decode` above --
   * `encode` writes a tree to an archive, `decode` reads one back. A Web
   * Bundle has no directory-entry concept at all (`wbn.BundleBuilder` has
   * no such exchange kind), so an empty `<Dir>` inside an `encode="wbn"`
   * root produces no entry -- there's nothing to recreate it from on
   * unpack.
   */
  encode?: "loose" | "zip" | "wbn";
  mode?: string;
}

export interface FileProps extends BaseProps {
  name?: string;
  src?: string | Promise<string>;
  /**
   * Base64-encoded content, decoded to raw bytes and combined into this
   * file's content the same way `src`/`cmd` are (see content-util.ts's
   * `combineContent`) -- for authoring binary content directly inline in
   * JSX, with no on-disk file to point `src` at. Combines FIRST, before
   * `src`/`cmd`, matching the order those two already combine in. Strictly
   * validated (see `decodeBase64Strict`): malformed base64 throws rather
   * than silently decoding to the wrong bytes.
   */
  base64?: string;
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
   * Loose target only -- a container (`"zip"`/`"wbn"`) is always rebuilt as
   * one atomic unit, so there's no meaningful "does this individual entry
   * already exist" to ask.
   */
  onConflict?: "replace" | "append" | "prepend" | "skip" | "error";
}

/**
 * Stat info handed to `deletable()` for a real, existing match -- `null`
 * instead when the match no longer exists by the time it's stat'd (a race:
 * an earlier match in the same `<Rm>` removed a parent directory this path
 * was inside, or something outside this build's control deleted it between
 * the glob and the stat). `deletable` still runs in that case rather than
 * being skipped outright, so a caller can decide for itself whether "gone
 * already" is fine (return falsy) or worth failing loudly over (throw).
 */
export interface DeletableFileInfo {
  size: number;
  isDirectory: boolean;
  isFile: boolean;
  mtime: Date;
}

export interface DeletableContext {
  /** Path relative to outDir -- the same value that ends up in WriteSummary.removed. */
  path: string;
  /** The <Rm target> pattern (as authored, "!"-negation and all) this path matched. */
  pattern: string;
}

/**
 * Custom removal filter -- the escape hatch for any criterion `kind`/
 * `emptyOnly` don't cover (age, size, content, external state, ...) rather
 * than this codebase growing a dedicated attribute per possible criterion.
 * Runs AFTER `kind`/`emptyOnly` already excluded non-qualifying matches, as
 * a final, arbitrary say over what's left. Return/resolve truthy to delete,
 * falsy to leave it alone; throwing (or a rejected promise) aborts the
 * build the same way any other async prop failure does (PRD SS6.2), rather
 * than being treated as "falsy, so skip".
 */
export type DeletableFn = (
  file: DeletableFileInfo | null,
  context: DeletableContext,
) => boolean | Promise<boolean>;

export interface RmProps extends BaseProps {
  target: string;
  /**
   * Restrict matches to files (default, and the only behavior before this
   * option existed -- glob matching has always been `nodir: true`),
   * directories, or either. `"dir"`/`"any"` genuinely escalate what this
   * primitive can do: a directory match is removed recursively (unless
   * `emptyOnly`), not just unlinked.
   */
  kind?: "file" | "dir" | "any";
  /**
   * For a directory match (`kind: "dir" | "any"`): only remove it if it's
   * actually empty -- a non-recursive removal that fails loudly (Node's own
   * `ENOTEMPTY`) rather than silently deleting everything inside, the safer
   * default for "clean up this directory, but only if nothing's using it
   * anymore" (an assertion, not a blanket `rm -rf`). Meaningless for
   * `kind: "file"` (the default); ignored there.
   */
  emptyOnly?: boolean;
  /**
   * What to do when this target ends up removing nothing at all (the glob
   * matched zero paths, or every match was filtered out by `kind`/
   * `emptyOnly`/`deletable`). Default `"ignore"` (today's behavior: fully
   * silent). `"warn"`/`"error"` catch the same class of mistake
   * `onConflict`/`encode`/`decode`'s own fail-loudly validation already
   * catches elsewhere in this codebase -- a typo'd or since-moved target
   * that quietly does nothing.
   */
  onMissing?: "ignore" | "warn" | "error";
  /** See `DeletableFn`'s own doc comment. */
  deletable?: DeletableFn;
}

/**
 * Any tag that isn't one of the three structural primitives is plain
 * markup. Widened to the general `symbol` type (not the exact `typeof
 * FRAGMENT`) so a sibling package's own JSX runtime -- which necessarily
 * has its own, differently-keyed Fragment symbol -- can still type-check
 * fileable's `Descriptor` as a valid JSX element when fileable components
 * (`<Dir>`/`<File>`) are nested directly inside that package's own JSX
 * (e.g. `@johnhenry/servable`'s `<Router>`/`<Group>`). See servable's
 * README "Mounting without from=" section for the runtime story -- this
 * type change only removes a false type error, both runtimes already
 * called function-typed tags directly.
 */
export type Tag = StructuralTag | symbol | string;

export interface Descriptor {
  tag: Tag;
  props: Record<string, unknown>;
  children: DescriptorChild[];
  /** Assigned by the Build stage; stable identity for linkTo()/symlink target lookups. */
  __id?: string;
  readonly [FILEABLE_DESCRIPTOR]?: true;
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
  /**
   * EXAMPLE: base URL an `ipfs://<cid>/<path>` `src` (on `<File>` or
   * `<IPFS>`) resolves against -- `ipfs://<cid>/<path>` becomes
   * `${ipfsGateway}${cid}/${path}`. Default: `"https://ipfs.io/ipfs/"`.
   */
  ipfsGateway?: string;
}

/**
 * "inline" (a single concatenated file, PRD SS5.2) isn't a distinct writer --
 * nesting a <dir> inside a <file> already produces exactly one real <file>
 * artifact via nameless inlining (SS5.1), written by whichever writer
 * (loose/zip/wbn) its enclosing context uses.
 */
export type RenderTarget = "loose" | "zip" | "wbn";

/** A real, addressable output artifact (a loose file/dir, a container entry, or an inlined file). */
export interface ArtifactNode {
  id: string;
  kind: "file" | "dir";
  descriptor: Descriptor;
  /** Path relative to outDir (loose), relative to the container root (zip/wbn), or self (inline). */
  outputPath: string;
  target: RenderTarget;
  /**
   * For target === "zip" | "wbn": the container's own outputPath (the
   * `.zip` or `.wbn` file every descendant in this subtree lands inside).
   * Same field for both formats -- "which atomic container do I belong to"
   * is the same question regardless of which format answers it.
   */
  containerPath?: string;
  /** A `Buffer` for binary content (see content-util.ts); plain text stays a `string`. */
  content?: string | Buffer;
  mode?: string;
  /** Resolved relative target for a real symlink (loose target only). */
  symlinkTo?: string;
  /** True if a requested symlink degraded to a copy (SS5.3). */
  symlinkDegraded?: boolean;
  children: string[];
}

/** A `<Rm>` node, resolved down to what write/loose.ts's `applyRemovals()` needs to act on it. */
export interface RemovalSpec {
  /** The target glob pattern, "!"-negation and basePath-joining already applied. */
  pattern: string;
  kind: "file" | "dir" | "any";
  emptyOnly: boolean;
  onMissing: "ignore" | "warn" | "error";
  deletable?: DeletableFn;
}

export interface LayoutResult {
  artifacts: ArtifactNode[];
  byId: Map<string, ArtifactNode>;
  removals: RemovalSpec[];
  warnings: string[];
}

export interface HashedArtifact extends ArtifactNode {
  hash: string;
  dependsOn: string[];
}

export interface HashResult {
  artifacts: HashedArtifact[];
  byId: Map<string, HashedArtifact>;
  removals: RemovalSpec[];
  warnings: string[];
}

export interface LockFileShape {
  version: 1;
  /** Recorded so a bare hex digest never quietly represents a different policy across releases. */
  algorithm: string;
  /** Keyed by ArtifactNode.id, not outputPath -- outputPath alone collides across sibling containers. */
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
