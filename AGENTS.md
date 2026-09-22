# Agent playbook

`@johnhenry/fileable` — declaratively describe filesystem artifacts (files,
directories, deletions) using JSX as the composition language. Single
package, Node >= 26, `node --test` via `scripts/run-tests.mjs` (`npm test`),
builds to `dist/` via `tsc` (`npm run build`). Most changes here touch the
five-stage pipeline (`src/build.ts` -> `resolve.ts` -> `layout.ts` ->
`hash.ts` -> `write/{loose,archive,packfile}.ts`) or the CLI (`bin/`); tests
and examples both compile through the same `dist/` output real consumers get.

`CLAUDE.md` in this directory is a symlink to this file.

## The verification loop (before every push)

1. `npm run build` — `tsc -p tsconfig.json`; compiles `src/`, `bin/`,
   `test/`, and `examples/**/*.tsx` together (examples are typechecked, not
   just src).
2. `npm test` — `pretest` reruns the build first, then
   `node --test scripts/run-tests.mjs`. No suite here is allowed to SKIP.
3. `npm pack --dry-run` — read the file list, not just the exit code;
   `files` is `dist/src`, `dist/bin`, `README.md`, `CHANGELOG.md`, `LICENSE`.
4. A genuinely fresh clone:
   `git clone . /tmp/fileable-verifyN && cd $_ && npm ci && npm run build && npm test`.
   This is the only way to catch "works on my checked-out tree" bugs
   (missing files in `package.json`'s `files`, undeclared deps).
5. Run the examples that ship a real driver script (`examples/05-ipfs-src/run.mjs`
   today) after building — `npm run build && node examples/05-ipfs-src/run.mjs`.
6. Commit, push, close the issue with a comment naming the commit SHA.

CI (`.github/workflows/ci.yml`) runs build then test in that order; match it
locally — a stale or missing build produces failures that look like real
source bugs but aren't.

## Repo-specific gotchas

- **`cmd` is a real trust boundary, gated behind `allowExec`.** `render(tree,
  { allowExec: true })` is required before the `cmd` prop is allowed to shell
  out at all; without it, encountering `cmd` throws immediately rather than
  silently no-op'ing. Don't loosen this default anywhere (CLI, SDK, tests)
  without updating the README's `## Security model` section too.
- **Two artifacts resolving to the same output path throw, always** — there
  is no "last write wins" inside one build. `onConflict` only governs a
  Write about to touch a path that already has content from *outside* the
  build (a pre-existing file on disk), not a same-build collision. Don't
  conflate the two when reading a bug report about "duplicate paths".
- **`encode`/`join`/`onConflict`/`decode` all fail loudly on an unrecognized
  value** — no silent fallback to a default. If you add a new value to any
  of these enums, add it to every validation branch at once; a value
  accepted by one JSX prop path and rejected by another (JSX vs. calling the
  factory function directly) is a real, previously-hit bug shape.
- **`name` is required at the root and inside `Dir`, optional inside `File`**
  (nameless inlining). Getting this rule wrong in a new primitive silently
  breaks the encode="zip"/"wbn"/one-concatenated-file equivalence the whole
  design rests on — see README's "The three primitives" for the full rule,
  including the servable-specific accommodation for a nameless bare `File`
  mount root.

## Definition of done

A change is done when all of the following hold, not just when tests pass:

- A regression test exists for any bug fixed — fixing a bug without a test
  that would have caught it means it can come back unnoticed.
- Anything the feature does **not** do is stated in the README (or the
  code), not only in an issue comment.
- `CHANGELOG.md` has an entry citing the commit/PR.
- A new tag/primitive follows README's "Adding a new tag" checklist
  (`types.ts` union entry, `components.ts` factory, `jsx-runtime.ts`
  `RESERVED_TAGS` entry, the real resolution logic) — and the section itself
  is updated if the new tag changes the answer to "how do I add one".

## Non-goals

Runtime UI/hydration is explicitly out of scope (see the design PRD's
Non-Goals) — fileable renders a tree once, to disk or an archive; it does
not re-render in a browser. Content *processing* (resizing, transcoding,
optimization) is a real, acknowledged gap, not a non-goal — `src`/`cmd` pass
bytes through byte-exact, nothing more.

## Releases

Bump `version` in `package.json` in a PR, add the `CHANGELOG.md` entry, merge,
then `gh release create v<version>` — the release event triggers
`.github/workflows/publish.yml`, which is idempotent (skips if the version is
already on npm).
