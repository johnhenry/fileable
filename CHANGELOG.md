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

### Added (examples)
- `examples/03-docs-archive-and-single-page`: the same three `src` partials
  feed both an `as="archive"` zip of individually-addressable pages and a
  `join="dom-merge"` single page, demonstrating SS5.2 ("three
  materializations of the same authored tree") concretely.

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
