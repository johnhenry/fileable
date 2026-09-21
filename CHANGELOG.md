# Changelog

## Unreleased

### Added
- **EXAMPLE: `src="env://VAR_NAME"` and `<MarkdownHTML>`, two more answers
  to "how easy is it to add a new tag" alongside `ipfs://`/`<IPFS>`.**
  `env://VAR_NAME` is the smallest possible new `src` scheme -- no network,
  no filesystem, just `process.env[varName]`, throwing (not silently
  resolving to empty content) when unset, matching every other `src`
  branch. `<MarkdownHTML name="..." src="...">` is a genuinely new tag
  (its own `RESERVED_TAGS` entry, its own required-`src` validation,
  normalizes to `"file"` the same way `<IPFS>` does) built entirely from
  *existing* pieces: it calls `loadSrc()` itself -- so `src` can be a local
  path, `https://`, `ipfs://`, `env://`, anything the other branches
  already support -- then pipes the result through the pre-existing
  `markdownToHtml()` runtime helper (`markdown.ts`), wiring "load a file,
  then run a transform on it" up as a real primitive instead of something
  called manually. Named `MarkdownHTML`, not `Markdown` -- the tag name
  says what it *produces* (renamed mid-implementation once this ambiguity
  was pointed out, before it shipped anywhere). Binary content or a
  code-module `src` throws a clear error rather than feeding garbage into
  `marked`. Verified for real: `test/markdown-tag.test.ts` exercises all
  three `src` schemes through the actual tag (not just `loadSrc()` in
  isolation), including a full `render()` round-trip writing real
  converted HTML to disk. See README's "Adding a new tag" section.
- **`kind`/`emptyOnly`/`onMissing`/`deletable` on `Rm`.** Closes two real
  gaps: `target` matched files only (`nodir: true`, hardcoded, no way to
  target a directory at all) and stayed completely silent when it matched
  nothing -- both inconsistent with this codebase's own fail-loudly
  convention (`onConflict`/`encode`/`decode` all validate; `Rm` didn't).
  `kind="file" | "dir" | "any"` (default `"file"`, unchanged) lets a target
  match directories, removed recursively unless `emptyOnly` restricts it to
  a real `fs.rmdir()`-style "only if empty" removal (fails loudly with
  `ENOTEMPTY` otherwise, a safety-first default rather than a blanket
  `rm -rf`). `onMissing="ignore" | "warn" | "error"` (default `"ignore"`,
  unchanged) fires when a target ends up removing nothing at all --
  including when every raw match was filtered out by `kind`/`emptyOnly`/
  `deletable`, not only when the glob matched literally zero paths.
  `deletable: (file, context) => boolean | Promise<boolean>` is the
  general escape hatch for any removal criterion the other three don't
  cover (age, size, content, external state, ...), instead of this project
  growing a dedicated attribute per possible criterion -- runs after
  `kind`/`emptyOnly` already excluded non-qualifying matches, with the
  final say over what's actually removed; throwing aborts the build, same
  as any other async prop failure (PRD SS6.2). `file` is `null` when a
  match no longer exists by the time it's processed (almost always: an
  earlier match in the same `<Rm>` removed a parent directory this path
  was inside) -- `deletable` still runs rather than being skipped, so
  custom logic decides for itself whether that's fine or worth failing
  over. Verified deterministically, not left to chance: `test/rm.test.ts`
  triggers the real "parent removed before child is reached" race on
  purpose (confirmed via a real `glob("**")` run that a directory always
  sorts before its own children) rather than hoping to catch it.
  **Two real implementation bugs caught by actual failing tests while
  building this, not just reasoned about**: (1) `fs.rm(path, {recursive:
  false})` was assumed to behave like "remove only if empty" for
  `emptyOnly` -- it doesn't, it refuses *any* directory outright with
  `EISDIR` regardless of emptiness, confirmed directly; fixed by using the
  real API for that (`fs.rmdir()`) instead. (2) A `kind: "dir" | "any"`
  target expanding to `"**"` (like the pre-existing negated-target case
  always has) can match `"."` -- the search root itself -- newly dangerous
  now that a directory match can mean a *recursive* delete, where before
  `nodir: true` made it structurally impossible; `"."` is now explicitly,
  unconditionally excluded from every removal, not subject to `kind`/
  `emptyOnly`/`deletable` at all. Also: directory-vs-file classification
  now uses `lstat` rather than `stat` throughout (a symlink pointing at a
  directory is not itself a directory), the same reasoning `<Dir from>`'s
  own glob matching already established for exactly this distinction.
- **EXAMPLE: `ipfs://<cid>/<path>` support, two ways -- a new URI scheme on
  the existing `<File src>`, and a genuinely new `<IPFS>` primitive.**
  Built to answer "how easy is it to add a new tag", with two real,
  differently-sized answers living side by side rather than one abstract
  claim. `<File src="ipfs://...">` is the smaller one: one more branch in
  `resolve.ts`'s `loadSrc()`, reusing the exact binary-safe content handling
  every other branch (`https://`, local file, code-module import) already
  has. `<IPFS name="..." src="...">` is the genuinely new tag: its own
  `IPFSProps`/`StructuralTag` entry, its own `structural()` factory in
  `components.ts`, its own `RESERVED_TAGS` entry (the bare lowercase
  `<ipfs>` throws, same as `<dir>`/`<file>`/`<rm>`), and its own required-
  `src` validation in `resolve.ts` -- which then relabels the resolved
  node's own `tag` from `"ipfs"` to `"file"`, the same normalize-into-an-
  existing-tag trick `from="glob"` and `<Dir src decode>` already use, so
  `layout.ts`/`hash.ts`/every writer needs zero awareness `"ipfs"` exists.
  Both share one real fetch implementation (`fetchIpfs()`); a new
  `ipfsGateway` `render()`/`resolve()` option (default
  `"https://ipfs.io/ipfs/"`) says which gateway `ipfs://` resolves against.
  A real bug was caught and fixed while building this, not just reasoned
  about: the first `<IPFS>` implementation left `src` on the node after
  relabeling it to `"file"`, so the generic file-`src` handler immediately
  below fetched (and double-combined) the exact same content a second time
  -- caught by an actual failing test (`"<h1>...</h1><h1>...</h1>"`), fixed
  by deleting `props.src` once its own IPFS-specific fetch has consumed it.
  **Also a real, verified finding, not an assumption**: every major public
  IPFS gateway (ipfs.io, dweb.link, w3s.link, nftstorage.link) currently
  rejects a direct server-side fetch with `429`, migrating to browser-only
  service-worker access -- confirmed by actually trying each one, not
  read about. `examples/05-ipfs-src/run.mjs` therefore points
  `ipfsGateway` at a real local HTTP server (same technique
  `test/ipfs.test.ts` uses) rather than a public gateway, and says so.
  See README's new "Adding a new tag" section for the full walkthrough.
- **`src` + `decode="zip" | "wbn"` on `Dir`: the inverse of `encode` -- decodes
  an existing archive back into editable `<File>` children.** Closes a real
  gap: `encode="zip"`/`encode="wbn"` only ever went tree -> archive, with no way
  back into fileable's own pipeline short of shelling out to `unzip` or
  packfile's CLI. Decoded entries are genuinely editable, not a fixed
  passthrough -- each becomes an ordinary `<File>` child (prepended before
  this `<Dir>`'s own explicit children, same rule `from="glob"` already
  follows), and an explicit child sharing a decoded entry's `name` wins
  outright instead of colliding -- the one deliberate exception to this
  codebase's usual "two artifacts on the same path throw" rule, since
  overriding a handful of files from an otherwise-unpacked archive (the
  same relationship Docker's `FROM` + `COPY` layering has) is the actual
  point of this feature. `decode="zip"` uses `fflate`'s `unzipSync`
  (already a dependency, skips directory entries -- paths ending in `/`);
  `decode="wbn"` gunzips then parses via `wbn.Bundle`, using the same
  internal `ARCHIVE_BASE_URL` `encode="wbn"`'s writer uses (now factored into
  a small shared `src/wbn-constants.ts`, used by both sides) so the two are
  true inverses of each other, not just format-compatible. `src`/`decode`
  must be used together (either alone throws), and an unrecognized
  `decode` value throws too, matching `encode`/`onConflict`/`contentMode`'s
  own fail-loudly convention. Verified against real interop, not just internal
  round-tripping: `test/dir-decode.test.ts` decodes archives built directly
  via `fflate`/`wbn` (not produced by this package at all), round-trips a
  real fileable-produced `.zip`/`.wbn` byte-exact (including binary
  content), and exercises the override/add-new-file/directory-entry-
  skipping/validation-error paths end to end through the real `render()`
  pipeline, not just `resolve()` in isolation.
- **`encode="wbn"` on `Dir`: a third container render target, alongside
  `"loose"`/`"zip"`, that materializes a subtree as one `.wbn` file --
  gzip(`application/webbundle`), the format Chrome's Isolated Web Apps are
  built on -- directly readable by `@johnhenry/packfile`'s own
  `fromArchive()`/`createRouter()`/`createWebBundleRouter()` (that package's
  own archive format IS this format).** Implemented via a real, direct
  dependency on `wbn` (the real, Google-maintained package `@johnhenry/
  packfile` itself is built on) -- **not** a dependency on
  `@johnhenry/packfile`. That package isn't published to npm, so depending
  on it directly would mean `npm install @johnhenry/fileable` doesn't
  resolve outside a matching monorepo checkout; `wbn` is a real, published
  package, and producing the exact same byte format only ever needed the
  same underlying library, not the intermediate one. (This package briefly
  did depend on `@johnhenry/packfile` via `file:../packfile` during
  development -- removed once the format itself moved onto `wbn` directly on
  both sides, making the dependency redundant rather than load-bearing.)
  New writer: `src/write/wbn.ts`, parallel to `src/write/zip.ts` (renamed
  from `src/write/archive.ts` -- see naming note below; same
  root/dirty-tracking/skip-on-unchanged logic, generalized: `hash.ts`'s
  `isArchiveRoot` became `isContainerRoot`, and `ArtifactNode.archivePath`
  was renamed to `containerPath` since "which atomic container do I belong
  to" is the same question for a `.zip` root or a `.wbn` root). New
  `src/mime.ts`: a small extension -> Content-Type table (`wbn`'s
  `BundleBuilder.addExchange()` requires one for any non-empty exchange
  body), deliberately the same table and the same `Object.hasOwn()`
  prototype-pollution-safe lookup as `@johnhenry/packfile`'s own
  `lib/mime.mjs`. Nesting `encode="zip"`/`encode="wbn"`/`encode="loose"` inside each
  other (switching container formats mid-tree, or escaping a container back
  to loose) already threw before this change for zip/loose; that guard is
  now generic and covers all three. One real format difference from
  `encode="zip"`: a Web Bundle has no directory-entry concept at all
  (`wbn.BundleBuilder` has no such exchange kind), so an empty `<Dir>`
  inside a `"wbn"` root contributes no entry and isn't recoverable on
  unpack; documented in README rather than worked around, since it's
  inherent to the target format, not a bug.
  **Naming, two renames**: the container values `"archive"`/`"packfile"`
  were renamed to `"zip"`/`"wbn"` -- named after the actual wire format in
  each case, rather than a generic container word (`"archive"` -- which
  archive format?) or a specific ecosystem package name (`"packfile"` named
  this package's own sibling, not the format itself). Then, once `decode`
  was added as `encode`'s real inverse (see above), the prop itself was
  renamed from `as` to `encode` to read as that pair -- `encode` writes a
  tree to an archive, `decode` reads one back, rather than one of the two
  directions being named generically (`as`) and the other specifically
  (`decode`). `src/write/archive.ts` renamed to `src/write/zip.ts`
  (`writeArchives()` -> `writeZips()`) to match. All three old names
  (`as`, `"archive"`, `"packfile"`) are gone outright, not kept as
  deprecated aliases -- pre-1.0, no external consumers yet to preserve
  compatibility for.
- **`base64` prop on `File`, and a matching `binaryMode` option on `eject`.**
  `<File base64="...">` decodes and combines base64-encoded content the same
  way `src`/`cmd` already do (binary-safe, via the existing UTF-8 round-trip
  text/binary detection), combining first in the established order (`base64`
  -> `src` -> `cmd` -> children). Malformed base64 throws (`FileableError`),
  same fail-loudly convention as invalid `onConflict`/`encode`/`join`/
  `contentMode`. On the `eject` side, `binaryMode: "ref" | "base64"` (default
  `"ref"`, unchanged behavior) is a second, independent axis from
  `contentMode`: `contentMode` decides whether a file's content is inlined
  or referenced at all; `binaryMode` decides how *binary* content inlines
  once `contentMode` says it should -- `"ref"` still throws (no safe way to
  put raw bytes in source text), `"base64"` inlines it as `<File base64>`
  instead. Lets `eject --content-mode inline --binary-mode base64` produce
  one fully self-contained source file, with no `src="..."` pointing back at
  the original files, that still round-trips byte-exact through `build()`.
  CLI: `--binary-mode <ref|base64>`. See README's "The three primitives" and
  "`eject`" sections.
- **`Descriptor.tag`'s type widened from `StructuralTag | typeof FRAGMENT |
  string` to `StructuralTag | symbol | string`.** Enables literal
  `<Dir>`/`<File>` JSX to be nested directly inside a consumer package's
  own JSX (e.g. `@johnhenry/servable`'s `<Router>`/`<Group>`) in the same
  file, under that package's `@jsxImportSource` pragma. Both runtimes'
  `jsx()` already called function-typed tags directly, so this always
  worked at runtime; only the type-checker rejected it, since fileable's
  own Fragment marker is a different `Symbol.for(...)` key than any
  consumer's. See `servable`'s README "Mounting without `from=`" for the
  full writeup.

## 0.0.1

### Added
- **`FILEABLE_DESCRIPTOR`**: a `Symbol.for("fileable.descriptor")`
  global-registry brand every `Dir`/`File`/`Rm`/JSX-produced descriptor now
  carries. Lets a consumer package (`servable`) recognize a fileable
  descriptor appearing as a raw JSX child, not just behind a `from=` prop,
  without shape-based duck typing -- every `Descriptor`, from any package
  built the same way, has the identical `{tag,props,children}` shape, so a
  structural check alone can't tell them apart once a fileable node might
  appear anywhere a servable node could. A global-symbol-registry key means
  a consumer needs no import of this package at all to check for it.

### Fixed
- **`<Dir from="glob">` crashed with a raw `EISDIR` instead of skipping a
  symlink that points at a directory.** `glob`'s `nodir: true` filters by
  each match's own dirent type (an `lstat`), not its followed real type --
  a symlink whose *target* is a directory survives that filter and comes
  back looking like a file match, and reading it later threw. Found by
  actually matching one (a real symlink cycle in a temp directory,
  `ln -s . loop`) through `resolve()`. Now each match is `stat`-checked
  (following the link) after globbing; a match that resolves to a
  directory, or can't be `stat`-checked at all (a broken symlink), is
  skipped with a `warn()` instead of failing the build. This is also what
  keeps a symlink cycle like `loop -> .` from being read as content --
  `glob`'s own `follow: false` default already stops `**` from recursing
  more than one level into a symlinked directory, so the only remaining
  gap was this one dirent-vs-real-type mismatch for a symlink a glob
  matches *directly*.
- **`<Dir from>`'s subdirectory-preserving naming silently collapsed to a
  bare basename whenever the glob pattern itself was absolute**, which
  could then produce a false "duplicate output path" error for two
  same-named files in different subdirectories (confirmed by reproducing
  it). The prefix-stripping check compared an absolute pattern-base against
  a match path made relative to `cwd` -- two representations that never
  actually shared a prefix. Fixed by resolving the pattern's own base to an
  absolute path up front and computing each match relative to *that*
  (the same fix already applied to the equivalent logic in the sibling
  `servable` package).

## 0.0.0

Adopted into the `@johnhenry/*` family: renamed from unscoped `fileable` to
`@johnhenry/fileable`, version restarted at 0.0.0 (a new address and era,
not a maturity signal -- see the README's provenance note). The v2 rewrite
below was never released unscoped; the scope migration and the rewrite's
first real release happen together. Default branch renamed `master` ->
`main`. Every `import ... from "fileable"` (including the string `eject`
itself generates in its output) now reads `"@johnhenry/fileable"`.

## 2.0.0

Full rewrite per the v2 design PRD. Breaking in every respect -- there is no
compatibility shim with v1.

**Why it looks the way it does:** v1's `FILE`/`FOLDER`/`CLEAR` directives are
kept as architectural idioms but reduced to three JSX primitives
(`<dir>`/`<file>`/`<rm>`), following a Docker-idioms-not-Docker-syntax
philosophy -- a small closed instruction set, `src` as an explicit
`FROM`-style inheritance point, content-hash layer caching in place of Docker
layer caching, and `as="loose" | "archive"` as a multi-stage-build-style
choice between a full/slim materialization of the same tree.

### Fixed (pre-release bug hunt)
A general correctness pass before the first real release, verified by
actually reproducing each one in a scratch directory before fixing it, not
just by reasoning about the code:
- **Incremental cache didn't check the output still existed.** `isUnchanged`
  only compared hashes -- if a previous build's file, directory, or archive
  was deleted by hand (or a previous run was interrupted partway), a rebuild
  with caching on (the default) silently reported "skip" forever and never
  recreated it. Now every "unchanged by hash" artifact is also checked
  against disk before being skipped; if it's missing, it's rewritten
  regardless of the hash. Applies to loose files, loose dirs, and archives.
- **Calling `render()` twice on the same tree object corrupted the second
  call.** Build/Resolve mutate descriptor nodes in place (folding resolved
  `src`/`cmd` content into `props.__resolvedContent`, splicing `<Dir from>`
  matches into `children`) -- reusing one tree object across two `render()`
  calls (a natural SDK pattern: build a tree once, render it under different
  options) leaked the first call's mutations into the second. Confirmed with
  a real PNG: its content literally doubled on the second call. Fixed by
  deep-cloning the tree once at the top of `render()`, before Build ever
  touches it.
- **A loose `symlink` pointing at a target inside an archive silently
  pointed at nothing.** Archive-internal artifacts' `outputPath` is relative
  to the archive's own root, not the real filesystem, but Layout was
  computing a real symlink target from it anyway. Now throws a clear error
  instead of producing a symlink to a path that doesn't exist.
- **`onConflict` was silently ignored for symlink `<File>`s.** A pre-existing
  path (real content, not something fileable wrote) got force-removed and
  replaced with a symlink regardless of `onConflict="error"`/`"skip"`. Now
  honored the same as for regular files; `"append"`/`"prepend"` (which don't
  make sense for a symlink) throw when there's actually something to
  conflict with, and behave like a normal write when there isn't.
- **A Promise used directly as JSX content silently stringified to
  `"[object Promise]"`.** The realistic trigger is an async component --
  `<AsyncFoo/>` invokes it immediately and gets back a Promise, not its
  eventual result, since Resolve only ever awaits promise-valued *props*
  (`src`, `cmd`, ...), never arbitrary child content. Now throws instead of
  silently writing garbage.

### Added
- Fileable's own JSX runtime (`fileable/jsx-runtime`, `fileable/jsx-dev-runtime`)
  -- no React/Solid/Astro dependency.
- A five-stage evaluation pipeline (Build -> Resolve -> Layout -> Hash ->
  Write), each stage independently exported and testable.
- Nameless inlining: a `<file>`/`<dir>` nested inside a `<file>` becomes a
  content fragment instead of a path, unifying "compose fragments into one
  file" and "compose files into a folder" into one rule.
- Three interchangeable render targets from the same authored tree: loose
  files/dirs, a `.zip` archive (`as="archive"`, via `fflate`), or a single
  concatenated file (via nesting a `<dir>` inside a `<file>`).
- Content-hash incremental builds via `.fileable-lock.json`; unchanged
  artifacts are skipped on rebuild (archives are treated as one atomic unit).
- `link()`, `warn()`, `glob()`, `useCollection()` runtime API.
- `symlink` support on `<file>`, with a documented degrade-to-copy fallback
  (plus a warning, or a hard error under `strict: true`) when the render
  target can't hold a real symlink, and a Windows
  EPERM/no-Developer-Mode fallback at write time.
- `cmd` attribute (shell out, use stdout as content), gated behind an
  explicit `allowExec: true` render option.
- `join="dom-merge"` for merging multiple full/partial HTML fragments into
  one shared `<head>`/`<body>` instead of a raw string concatenation.

### Removed
- The `fileable-component-file`, `fileable-component-folder`,
  `fileable-component-clear`, and `fileable-iterator` companion packages --
  everything now lives in this one package.
- The `react`/`react-dom`/Babel/Rollup/TSLint/Tape toolchain.
- The `WARNING`/`ERROR` yieldable directives (replaced by `throw` for fatal
  errors and `warn()` for non-fatal ones).
- The `renderConsole` dry-run renderer (not part of the v2 design; may return
  as a dedicated preview mode if there's demand).

### Added (post-review)
- `markdown(text)` runtime helper -- a thin, synchronous wrapper around
  `marked`. Convenience only; content transformation is otherwise just
  calling any function you like inline (`{myTransform(text)}`), no fileable
  involvement needed. `examples/02-blog-with-index` now renders post bodies
  through it instead of dumping raw markdown text into the HTML output.
- `File`/`Dir`/`Rm` exported as ordinary functions (`import { File, Dir, Rm }
  from "fileable"`) -- **and now the only supported way to reach the three
  primitives.** The bare lowercase `<dir>`/`<file>`/`<rm>` tags are reserved
  and throw a clear error pointing at the correct import if authored
  directly (`jsx-runtime.ts`'s `RESERVED_TAGS`); they briefly worked as
  interchangeable spellings before this was tightened up. Every template
  now has one real, importable, "go to definition"-able symbol per
  primitive instead of a string matched inside the JSX runtime dispatch.
  Also callable directly without JSX, e.g. `File({ name: "a.txt" })`. All
  three examples updated to `<Dir>`/`<File>`/`<Rm>`.
- `fileable build <template>` CLI (`bin/fileable.ts`, `dist/bin/fileable.js`
  via the `fileable` bin entry): imports a template module's default
  export and renders it, so templates don't each need their own `await
  render(tree, {...})` boilerplate. `outDir`/`cwd` default to the template
  file's own directory. All three examples switched from self-contained
  scripts (each calling `render()` itself) to `export default template;`,
  now driven by the CLI instead.
- `fileable build --var key[:type]=value` (repeatable, `bin/vars.ts`):
  passes typed values into a template whose default export is a function
  (`(vars) => <Dir>...`) instead of a plain tree. TypeScript-like type
  annotation (`key:type=value`) controls how the CLI-string value is
  coerced -- `string` (default), `number`, `boolean`, or `json`; `--var
  draft`/`--var draft:boolean` with no `=value` is shorthand for `true`.
  `--var` on a plain-tree template is ignored with a warning, not an error.
  `examples/01-hello-world` now takes an optional `--var name=...`.
- `<Dir from>` now preserves matched files' subdirectory structure relative
  to the glob's fixed prefix (`assets/**/*` matching `assets/en/index.html`
  produces a child named `en/index.html`, not just `index.html`) instead of
  flattening every match to a bare basename -- which, besides losing
  structure, meant two matches sharing a basename in different source
  subdirectories silently collided on write with no warning (confirmed and
  fixed after being asked about "filling" a folder from existing files).
- Two artifacts resolving to the same output path within one build now
  throw a clear `FileableError` instead of silently colliding (previously:
  both got written, whichever ran last in Write won, with no trace the
  other was ever lost). Kept as an unconditional error rather than a
  choice, since it's essentially always an authoring mistake.
- `onConflict="replace" | "append" | "error"` on `<File>` (default
  `"replace"`, matching prior behavior): governs what happens when Write
  is about to touch a path with content already on disk from *outside*
  this build (not something the current tree already produced or a
  cache-skipped-as-unchanged file). `"append"` restores the `append`
  behavior v1's `FILE` directive had and this rewrite hadn't carried
  forward; `"error"` refuses to touch it. Loose target only.

### Added (examples)
- `examples/03-docs-archive-and-single-page`: the same three `src` partials
  feed both an `as="archive"` zip of individually-addressable pages and a
  `join="dom-merge"` single page, demonstrating SS5.2 ("three
  materializations of the same authored tree") concretely.
- `examples/04-build-log`: `onConflict="append"` accumulating one
  timestamped line per `fileable build` run into `build-log.txt` instead
  of overwriting it each time; also takes an optional `--var message=...`.

### Added (`eject` -- build's other dual)
`build` turns a JSX tree into a real filesystem tree; nothing did the
reverse. Added `fileable eject <path>` (SDK: `reflect(path, options)`),
which walks a real path and generates the fileable TSX source that would
build it, so `fileable build`'s output and `eject`'s output round-trip
through each other, byte-for-byte including binary files.

The one decision `build` never has to make that `eject` does: per file, is
its content **inlined** as source text, or **referenced** via `src="..."`
pointing back at the real file? `contentMode` (default `"infer"`) sniffs
via the same UTF-8 round-trip check `content-util.ts` already built for
binary-safe `src`/`cmd` -- text inlines, binary references, for free.
`"inline"`/`"ref"` force one for every file (forcing `"inline"` on binary
content throws -- there's no safe way to put raw bytes into source text).
`content` overrides (`glob -> mode`) win over the global mode for specific
files. `"ask"` defers the decision -- to an interactive CLI prompt, or an
`onAsk` callback for SDK callers -- for *text* files only, since binary
content has exactly one valid answer and there's nothing to ask about it.

Referenced files default to **not** being copied -- `src` points at the
real file's original location, computed relative to `outFile`/`--out`
(default: a sibling `<name>.tsx` next to the ejected path, so the
reference collapses to pointing right back into the directory being
described). `copyAssets`/`--copy-assets` copies referenced files into an
`assets/` directory next to the output instead, for a template that can
be moved independently of the tree it came from.

Deliberately not captured: file mode/permission bits, and the
`useCollection`/`linkTo` authoring-time relationships that produced a tree
-- `eject` reconstructs structure and content, not how a human got there.
`.fileable-lock.json` is skipped on the way in, since it's fileable's own
bookkeeping, not a real asset -- ejecting a tree that fileable itself just
built shouldn't produce a giant inlined JSON blob as a side effect.

### Fixed (consistency audit)
A diagnostic-only pass (checked docs against actual code/CLI output
directly, not from memory) found two real issues, fixed after:
- README's CLI options block had drifted from the real `--help` output --
  `-o, --out-dir`'s description was missing the build-vs-clean distinction
  added when `clean` shipped. Resynced.
- `as`, `join`, and `onConflict` were validated with inconsistent rigor:
  `as` got a check for the *nested-archive-conflict* case, but none of
  the three rejected an outright unrecognized value (a typo like
  `onConflict="repalce"` silently behaved like `"replace"`, with no error
  -- inconsistent with this codebase's own established fail-loudly
  convention everywhere else). All three now throw a clear `FileableError`
  for an unrecognized value. Also consolidated `join`'s parsing (layout.ts
  and serialize.ts each did the same unchecked cast independently) into
  one validated `parseJoin()` helper both call.

### Added (completeness audit: duals and supplementary states)
Prompted by an explicit "find missing duals/complementary/supplementary
operations" pass. Real gaps found and closed:
- `fileable clean [dir]` -- `build`'s missing dual. Removes exactly what a
  previous build wrote, read from `.fileable-lock.json` itself (not a
  guess at what "looks generated"), then removes the lock file too.
- `--dry-run` on both `build` and `clean` -- the missing "plan" side of
  this project's own "Docker idioms, not Docker syntax" framing (SS1.1),
  which otherwise only had the `apply` side. Runs the full pipeline (through
  Hash for `build`) and reports written/skipped/removed without touching
  disk, including the lock file.
- `onConflict="skip"` -- a genuinely missing state between `"replace"`
  (clobber it) and `"error"` (fail the whole build): leave an existing
  file completely untouched and keep going, for scaffolding that shouldn't
  overwrite something a user may have already customized but also
  shouldn't abort over that one file.
- `onConflict="prepend"` -- `"append"`'s direct mirror (new content before
  what's there, instead of after).

Checked and deliberately **not** added (false-positive duals, or ruled out
by the project's own non-goals):
- A read-only counterpart to `cmd`'s arbitrary execution -- unnecessary;
  templates are already plain JS/TS modules with full access to
  `process.env` and anything else read-only, no fileable-specific
  mechanism needed (consistent with "extension via plain JS, not new
  mechanisms").
- A reverse `markdownToHtml` (HTML -> markdown) -- fileable is a
  generator, not a round-trip converter; there's no scenario where it
  reads its own prior output back as an authoring format.
- A CLI "status"/inspect command to read back a previous build's state --
  `.fileable-lock.json` is already plain, human-readable JSON; a dedicated
  command would mostly just reformat something already directly
  inspectable, unlike `clean`, which does something genuinely tedious/
  error-prone to do correctly by hand.
- A fourth structural primitive (e.g. some "read" counterpart to
  `File`/`Dir`/`Rm`'s create/create/delete) -- the PRD's three-primitive
  closed set is a deliberate constraint, not an oversight; data access is
  already meant to live in plain JS (`glob()`/`useCollection()`), not a
  new tag.

### Fixed (found during the same audit)
- `<Dir as="archive">` nested inside an already-archived subtree, or
  `<Dir as="loose">` nested inside one trying to escape back out, were
  both silently ignored (fell through to "regular nested dir," still
  inside the outer archive either way) instead of erroring. Neither
  nested archives nor un-archiving mid-tree are supported, so both now
  throw a clear `FileableError` instead of silently doing the wrong thing.
  (First attempt at this fix only caught the *mismatched*-target case,
  missing archive-in-archive with the *same* requested value -- caught by
  actually running the test, not just reading the diff.)

### Changed (naming, before first release)
- `link()` renamed to `linkTo()` and `markdown()` renamed to
  `markdownToHtml()` -- both names were ambiguous about what they actually
  do (`link()` doesn't say to *what*; `markdown()` doesn't say *to what
  format*). Neither had shipped yet, so this is a same-version rename, not
  a deprecation -- every call site in the runtime, tests, examples, and
  this README was updated together.

### Fixed (binary content, found by testing the README's own claims)
- `src` (file reads and URL fetches) and `cmd` stdout forced UTF-8 decoding
  unconditionally, silently corrupting anything that wasn't valid UTF-8
  text -- confirmed by round-tripping a real PNG through `src`: every
  non-UTF-8 byte came back as a replacement character, growing a 69-byte
  file to 83 corrupted bytes. Fixed (`content-util.ts`): read raw bytes
  always, then decide text vs. binary by UTF-8 round-trip -- text stays a
  plain `string` (identical behavior/hash for every existing text
  scenario, zero test breakage), binary becomes a `Buffer`, preserved
  byte-exact through Layout's content composition, Hash's digest (`Buffer`
  fed directly to `crypto`'s `update()`, not string-concatenated first),
  the loose writer (`fs.writeFile` already accepts a `Buffer`), and the
  archive writer (a `Buffer` *is* a `Uint8Array`, used directly instead of
  `fflate`'s `strToU8`). Verified round-trip-identical for `src`, `cmd`,
  and inside a `.zip`. The README's "Not a fit: image/binary asset
  pipelines" line was wrong as stated -- corrected.

### Fixed (found while closing test-coverage gaps, before first release)
- `src="partial.js"` reused across two separate `<file src>` occurrences
  spliced the *same* object (Node's `import()` cache memoizes module
  namespace objects) into two places in the tree, silently violating SS5.4
  ("the same JSX element instance must not appear twice") whenever that
  shared content contained a `link()`/nested `<file>`. Fixed with a
  `cloneDescriptorTree()` deep-clone (preserving internal identity
  relationships within each clone) before handing an imported module's
  default export off to Build. Found while building the archive +
  dom-merge example above, which reuses the same `src` in two places.
- `.fileable-lock.json` was keyed by `outputPath` alone, which collides
  across sibling archives that happen to share a relative path (e.g. two
  `as="archive"` dirs each containing their own `index.html`) -- now keyed
  by the artifact's fully-qualified `id`.
- An archive's aggregate hash sorted its descendants' bare hash *values*,
  not hash bound to path -- two files swapping content across paths
  produced the same aggregate hash. Fixed by hashing a canonical, path- and
  kind-tagged manifest instead.
- `mode` wasn't part of an artifact's hash at all, so a mode-only change
  would never trigger a rewrite -- and separately, `fs.writeFile`'s own
  `mode` option is a no-op on an existing file, so even a rewrite wouldn't
  have actually re-`chmod`ed it. Both fixed: `mode` now participates in the
  hash, and Write always applies `mode` via an explicit `chmod`.
- `<rm target="!negated">` was broken for any `<rm>` not at the render
  root: joining the target with its directory context buried the leading
  `!` mid-string, and separately the negated branch always globbed the
  entire `outDir` rather than scoping `**` to the `<rm>`'s own directory.
- A `symlink` given as a literal string target was run through the same
  root-relative-path conversion as a `Descriptor` target, double-relativizing
  it (`ln`-style semantics require using the string as-is).
- `link()` used inside a plain markup tag's attribute (e.g. `<a
  href={link(...)}>`, the common case) was never substituted, because
  Layout's substitution pass only tracked "current artifact" via an
  identity map populated for `dir`/`file` nodes -- markup nodes fell through
  to `undefined` and were silently skipped.

### Notes on two PRD ambiguities resolved during implementation
See the pull request description for the full reasoning; in short:
- `link()`/`symlink` targets are resolved via an opaque marker substituted
  during Layout (once the path table is complete), not synchronously at the
  JSX call site.
- `useCollection()` dependency tracking is conservative (folded into every
  artifact's hash for the current build) rather than attributed per
  consuming artifact, since `useCollection()` is typically called at module
  top level, before any artifact exists to attribute it to.
