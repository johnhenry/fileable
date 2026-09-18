# Changelog

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
