# fileable

[![npm version](https://img.shields.io/npm/v/%40johnhenry%2Ffileable.svg)](https://www.npmjs.com/package/@johnhenry/fileable)
[![CI](https://github.com/johnhenry/fileable/actions/workflows/ci.yml/badge.svg)](https://github.com/johnhenry/fileable/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/%40johnhenry%2Ffileable.svg)](LICENSE)

Full documentation: [opensource.johnhenry.me/fileable](https://opensource.johnhenry.me/fileable/)

Declaratively describe filesystem artifacts -- files, directories, and
deletions -- using JSX as the composition language.

Fileable v2 is the spiritual successor to `fileable` (2019), which rendered
file trees from JSX via an async-iterator component protocol inspired by
[React FS Renderer](https://github.com/ericvicenti/react-fs-renderer). v2
keeps that core insight -- JSX's tree/composition/expressiveness is a better
fit for describing nested file output than a flat instruction list -- while
adding incremental builds, cross-file data flow, and a single consolidated
package.

It ships its own JSX runtime (no React/Solid/Astro dependency) and is best
described as **"JSX for describing filesystem artifacts, with
Docker-flavored build discipline"**: a small, closed set of primitives
(`Dir`, `File`, `Rm`), content-hash layer caching (`.fileable-lock.json`),
and four interchangeable output shapes (a folder of loose files, a zip
archive, a Web Bundle, or one concatenated file) from the same authored
tree.

> Previously published as `fileable` (2019-2022, last unscoped release
> 0.0.24 -- the v1 iterator-protocol design, superseded above). The v2
> rewrite was never released unscoped; adoption into `@johnhenry/fileable`
> and the version restart to 0.0.0 happened together -- a new address and
> era, not a maturity signal.

## Contents

- [Where this fits](#where-this-fits)
- [Installation](#installation)
- [Quick example](#quick-example)
- [The three primitives](#the-three-primitives)
- [Adding a new tag](#adding-a-new-tag)
- [Runtime API](#runtime-api)
- [CLI](#cli)
- [Examples](#examples)
- [Security](#security)
- [Migrating from v1](#migrating-from-v1)
- [Design background](#design-background)
- [License](#license)

## Where this fits

- **Scaffolding / project generators** (Plop/Hygen/Yeoman territory) --
  `Dir`/`File`/`Rm` plus the CLI's `--var` make a JSX-native "generate a
  skeleton from a template with parameters" tool. `onConflict` matters
  here specifically: `"error"` protects hand-edited files from a re-run
  generator clobbering them, `"append"` lets a generator add to something
  ongoing (a changelog, a registry file) instead of overwriting it.
- **Static site / docs generators**, with one trick most don't have: the
  same authored tree renders as loose files, a zip, *or* one concatenated
  page (nameless inlining + `join="dom-merge"`) without rewriting
  anything -- see `examples/03-docs-archive-and-single-page`.
- **Build-time codegen with incremental caching** -- deriving config or
  manifest files from a data model (CI workflows, client stubs,
  docker-compose), where `.fileable-lock.json` skipping unchanged output
  starts to matter once the generated set gets large.
- **Append-only build artifacts** -- logs, manifests, audit trails that
  should accumulate across runs instead of regenerating from scratch; see
  `examples/04-build-log`.
- **Distributable bundle packaging** -- `encode="zip"` for producing a
  downloadable zip (plugin package, release bundle) from the same source
  that also produces the live/loose output.
- **A whole static site as one servable blob** -- `encode="wbn"` for a
  `.wbn` file (gzip(`application/webbundle`), the format Chrome's
  [Isolated Web Apps](https://developer.chrome.com/docs/iwa/introduction)
  are built on, via the real `wbn` package directly) readable by
  `@johnhenry/packfile`'s own `fromArchive()`/`createRouter()` (an
  in-memory `(Request) => Response` router over exactly this format) --
  produced without depending on `@johnhenry/packfile` itself, for shipping
  a site as one importable artifact instead of a directory of files.

`src`/`cmd` are binary-safe -- content is read/decided text-vs-binary by a
UTF-8 round-trip, so pointing `src` at an image or having `cmd` shell out to
a binary tool passes the bytes through byte-exact (loose, or inside a zip).
There's no *processing* pipeline, though: no resizing, transcoding, or
optimization built in -- that's still a real gap, just not a hard boundary
the way it first looked.

Not a fit: runtime UI (no hydration, explicitly out of scope -- see
Non-Goals in the design PRD), distributed or parallel builds, or anywhere a
mature, battle-tested tool matters more than the composition model -- this
is a fresh rewrite with no real-world users yet.

## Installation

```sh
npm install @johnhenry/fileable
```

## Quick example

```tsx
/** @jsxImportSource @johnhenry/fileable */
import { Dir, File } from "@johnhenry/fileable";

const template = (
  <Dir name="dist">
    <File name="hello.txt">Hello, world!</File>
  </Dir>
);

export default template;
```

```sh
fileable build template.js
```

produces:

```
dist/
└── hello.txt          "Hello, world!"
```

`outDir`/`cwd` default to the template file's own directory. Prefer to drive
it yourself instead of via the CLI? `render()` is a plain function --
`import { render } from "@johnhenry/fileable"; await render(template, { outDir: "." })`.

See [`examples/`](./examples) for these runnable in full, plus the ones
below. Every tree in this README reflects a real `fileable build` run
(inline annotations added for clarity, not part of the actual output).

## The three primitives

`Dir`/`File`/`Rm` are ordinary functions exported from `"fileable"` --
`import { Dir, File, Rm } from "@johnhenry/fileable"` and use them as JSX components
(`<File name="a.txt">...</File>`) or call them directly with no JSX at all
(`File({ name: "a.txt" })`). The bare lowercase `<dir>`/`<file>`/`<rm>` tags
are **reserved and throw** if written directly (a clear error pointing at
the correct import) -- they're not a shortcut, so there's always one real,
importable, "go to definition"-able symbol for each primitive rather than a
string matched somewhere inside the JSX runtime.

| Component | Purpose |
|---|---|
| `Dir` | A directory. `name`, `from` (glob -> one child per match, keeping matched files' subdirectory structure relative to the glob's fixed prefix), `src` + `decode="zip" \| "wbn"` (decode an existing archive into editable children -- the inverse of `encode`), `encode="loose" \| "zip" \| "wbn"`, `mode`. |
| `File` | A file, or -- nested inside another `File` -- a content fragment to inline. `name`, `src`, `base64`, `doctype`, `mode`, `symlink`, `cmd`, `join="concat" \| "dom-merge"`, `onConflict="replace" \| "append" \| "prepend" \| "skip" \| "error"`. |
| `Rm` | A removal. `target` (glob, supports `!` negation), `kind="file" \| "dir" \| "any"`, `emptyOnly`, `onMissing="ignore" \| "warn" \| "error"`, `deletable`. |

Two artifacts resolving to the same output path (e.g. two `from` matches
that still land on the same relative path, or a plain authoring mistake)
throw rather than silently colliding -- there's no "last write wins" for
content produced *within* one build. `onConflict` (default `"replace"`,
today's behavior) instead governs what happens when Write is about to
touch a path that already has content from *outside* the build:
`"append"`/`"prepend"` add to it (before or after), `"skip"` leaves it
completely untouched and keeps going (for scaffolding that shouldn't
clobber something the user may have already customized, but also
shouldn't fail the whole build over that one file), `"error"` refuses to
touch it and fails the build. Loose target only; a container (`"zip"` or
`"wbn"`) is always rebuilt as one atomic unit, so there's no per-entry
"already exists" to ask.

`encode="zip"`/`encode="wbn"` can't be requested again, switched to each other, or
switched back to `encode="loose"`, once already nested inside a container --
all three throw rather than silently doing nothing, since neither nested
containers, changing container formats, nor "escaping" a container mid-tree
are supported. An unrecognized value for `encode`, `join`, or `onConflict` (a
typo, e.g. `onConflict="repalce"`) also throws, rather than silently
falling back to the default as if nothing were wrong. Named after the
actual format in each case (`"zip"`/`"wbn"`), not a container/package name
-- earlier names `"archive"`/`"packfile"` were dropped as too generic and
too ecosystem-specific, respectively.

`encode="wbn"` renders a subtree to one `.wbn` file instead of a `.zip` --
gzip(`application/webbundle`), the format Chrome's Isolated Web Apps are
built on, via the real, Google-maintained `wbn` package directly (a real
dependency, not a reimplementation of the format). This is a real
dependency on `wbn` specifically, **not** on `@johnhenry/packfile` --
that package's own archive format IS this format (see its own
`lib/to-archive.mjs`), so producing byte-for-byte the same file needs only
the same underlying library, not the intermediate package (which also
isn't published to npm, unlike `wbn`). The resulting file is directly
readable by `@johnhenry/packfile`'s own `fromArchive()` (back into a flat
path -> content map) and `createRouter()`/`createWebBundleRouter()` (serve
it directly as an in-memory HTTP router, no unpacking to disk needed). One
real difference from `encode="zip"`: a Web Bundle has no directory-entry
concept at all -- only files are stored, so an empty `<Dir>` inside a
`"wbn"` root contributes no entry and doesn't come back on unpack.

`src` + `decode` on `<Dir>` is the inverse of `encode` -- archive back into
a tree, instead of tree into an archive:

```tsx
<Dir name="remixed" src="site.wbn" decode="wbn">
  {/* Every entry in site.wbn becomes an ordinary <File> child here,
      automatically. Add more children to layer new files on top: */}
  <File name="contact.html">New page</File>
  {/* Or override one of the decoded entries outright, by name: */}
  <File name="index.html">Replaces whatever was in the archive</File>
</Dir>
```

Decoded entries are genuinely **editable children**, not an opaque
passthrough -- each one becomes a real `<File>`, prepended before this
`<Dir>`'s own explicit children (same rule `from="glob"` already follows).
The one deliberate exception to fileable's usual "two artifacts on the same
path throw" rule: an explicit child sharing a decoded entry's `name` wins
outright rather than colliding, since overriding a handful of files from an
otherwise-unpacked archive -- the same relationship Docker's `FROM` +
`COPY` layering has -- is the actual point of this feature, not a mistake
to guard against. `decode="zip"` uses `fflate` (already a dependency);
`decode="wbn"` uses the same `wbn` package `encode="wbn"` writes with, so a
`.wbn` this package wrote is always readable by this same `<Dir src decode>`
(and vice versa) -- verified for real, including against archives built
directly via `fflate`/`wbn` rather than by this package itself, not just
internal round-tripping (`test/dir-decode.test.ts`). `src`/`decode` must be
used together -- either alone throws, and so does an unrecognized `decode`
value, matching this codebase's fail-loudly convention everywhere else.

`base64` is a `File` prop for content that's already base64-encoded (a
binary asset embedded directly in a template, a value pulled from an API
response) -- `<File name="logo.png" base64={logoBase64} />` decodes it and
combines it with `src`/`cmd`/children exactly like any other content
source, just first in the combination order (`base64` -> `src` -> `cmd` ->
children). Malformed base64 throws rather than writing corrupted bytes.

`Rm`'s `target` glob has always matched files only (`nodir: true`, never
configurable before now) and stayed completely silent when it matched
nothing at all -- both real gaps against this codebase's own fail-loudly
convention elsewhere. Three attributes close them:

- **`kind="file" | "dir" | "any"`** (default `"file"`, today's only
  previous behavior) -- `"dir"`/`"any"` are a real escalation: a directory
  match is removed *recursively* (unless `emptyOnly`), not just unlinked.
- **`emptyOnly`** -- for a directory match, only remove it if it's
  genuinely empty: a non-recursive `fs.rmdir()`-style removal that fails
  loudly (`ENOTEMPTY`) on anything else, rather than a blanket `rm -rf`.
  The safer default for "clean up this directory, but only if nothing's
  using it anymore" -- an assertion, not a sweep.
- **`onMissing="ignore" | "warn" | "error"`** (default `"ignore"`, today's
  silent behavior) -- fires when a target ends up removing nothing at all
  (zero glob matches, or every match got filtered out by `kind`/
  `emptyOnly`/`deletable`), the same class of mistake `onConflict`/
  `encode`/`decode`'s own validation already catches elsewhere: a typo'd
  or since-moved target that quietly does nothing.

**`deletable`** is the escape hatch for any removal criterion the three
attributes above don't cover (age, size, content, external state, ...)
rather than this project growing a dedicated attribute per possible
criterion -- an `async (file, context) => boolean` called for each
match that already passed `kind`/`emptyOnly`, with the final say over
whether it's actually removed:

```tsx
<Rm
  target="*.log"
  deletable={async (file, { path }) => {
    if (file === null) return false; // already gone by the time we got here
    return Date.now() - file.mtime.getTime() > 7 * 24 * 60 * 60 * 1000; // older than a week
  }}
/>
```

`file` is `null` when the match no longer exists by the time it's
processed (almost always: an earlier match in the same `<Rm>` removed a
parent directory this path was inside) -- `deletable` still runs rather
than being skipped outright, so custom logic can decide for itself whether
that's fine (return `false`) or worth failing loudly over (`throw`).
Throwing (or a rejected promise) aborts the whole build, the same as any
other async prop failure.

Any other JSX tag (`<h1>`, `<ul>`, `<a>`, ...) is plain markup content, not a
fileable primitive -- it's stringified into whichever `File` contains it.
Only `dir`/`file`/`rm`/`ipfs`/`markdownhtml` (the last two EXAMPLE
primitives, see "Adding a new tag" below) are reserved; any other lowercase
tag name is fine to use directly, exactly as shown in the examples.

A `File` or `Dir` nested inside another `File` isn't a separate path -- it's
folded into the parent's content (nameless inlining). This single rule is
what lets the same authored tree render as loose files, a zip archive, a
Web Bundle, or one concatenated file, just by choosing where the nesting
happens and what `encode` is set to.

**`name` is required at the root, optional everywhere nested inside another
`File`.** A root-level `File`/`Dir` -- the value you pass to `build()`, or
each top-level entry in a list of roots -- needs a real output path, so
`name` is required there and omitting it throws (`<file> requires a "name"
attribute`). Nested inside a `Dir`, `name` is still required (it's that
child's own path segment). Nested inside a `File`, per the "nameless
inlining" rule just above, `name` has no meaning at all and is never
required. If you're mounting a fileable tree into `@johnhenry/servable`
(see servable's README, "Mounting a fileable tree") rather than writing it
to disk directly, a nameless bare *`File`* (not `Dir`) mounted directly as
a `<Group>`/`<Router>` child is a special case servable itself handles for
you: there's no developer-chosen name to preserve in the URL in the first
place (unlike a *named* mount root, whose name servable always keeps as
part of the URL -- see the same section's "Naming"), so servable spares
you from inventing one purely to satisfy this rule. (Mounting several
named files with no enclosing folder name at all -- servable's Fragment-
root case, also covered in the same section -- doesn't hit this rule
either: a Fragment isn't a `File`/`Dir` root and was never subject to
fileable's name requirement to begin with.) That's a servable-specific
accommodation, not a change to this rule: calling
`build()` on a nameless root directly, without going through servable's
mount path, still throws exactly as described above.

## Adding a new tag

Two different-sized ways to teach fileable a new content source, both real
and tested (`src/resolve.ts`, `test/ipfs.test.ts`), using an IPFS example
(`<File src="ipfs://<cid>/<path>">` / `<IPFS>`) to illustrate the actual
cost of each:

**Smallest: a new URI scheme on the existing `src` prop.** `resolve.ts`'s
`loadSrc()` is already just a chain of `if` branches by URL shape
(`https?://` -> `fetch()`, a code file extension -> `import()`, otherwise ->
local `readFile()`). Adding `ipfs://<cid>/<path>` -> fetch via a gateway is
one more branch, reusing the exact same binary-safe content handling
(`bufferToContent()`) every other branch already uses:

```tsx
<File name="index.html" src="ipfs://bafybeig.../index.html" />
```

No new tag, no new component, no new type -- the whole cost is the new
branch itself.

**A genuinely new tag: `<IPFS>`.** Every existing primitive (`Dir`/`File`/
`Rm`) follows one small, repeatable pattern, so a new one does too:

1. A `Props` interface + a `StructuralTag` union entry (`types.ts`).
2. A one-line `structural("ipfs", props)` factory (`components.ts`) --
   copy-paste of `File`'s own.
3. A `RESERVED_TAGS` entry (`jsx-runtime.ts`) so the bare lowercase
   `<ipfs>` throws a clear "use `<IPFS>`" error instead of silently
   becoming markup text, same as `<dir>`/`<file>`/`<rm>` already do.
4. The one part that isn't boilerplate: real resolution logic in
   `resolve.ts`. `<IPFS>` fetches its content, then **relabels its own
   `node.tag` from `"ipfs"` to `"file"`** -- the same trick `from="glob"`
   and `<Dir src decode>` already use (synthesize/normalize into an
   *existing* tag once the new primitive's own work is done) -- so
   `layout.ts`/`hash.ts`/every writer needs zero awareness `"ipfs"` ever
   existed as a tag at all:

```tsx
<IPFS name="index.html" src="ipfs://bafybeig.../index.html" />
```

Both share one real fetch implementation (`fetchIpfs()` in `resolve.ts`) --
the tag-level wiring is what differs between the two, not the content
fetching. `ipfsGateway` (a `render()`/`resolve()` option, default
`"https://ipfs.io/ipfs/"`) is what `ipfs://<cid>/<path>` resolves against.

Run `examples/05-ipfs-src/run.mjs` to see both produce byte-identical
output for real. It points `ipfsGateway` at a real local HTTP server rather
than a public gateway -- verified directly, not assumed: every major public
IPFS gateway (ipfs.io, dweb.link, w3s.link, nftstorage.link) currently
rejects a direct server-side fetch with `429`, migrating to browser-only
service-worker access. For real usage, point `ipfsGateway` at a
self-hosted node or an authenticated gateway service instead of the
library's own default.

**A third scheme, `env://VAR_NAME`** (EXAMPLE), is the smallest of the
three -- no network, no filesystem, just `process.env[varName]`:

```tsx
<File name="version.txt" src="env://BUILD_VERSION" />
```

Missing throws, same as every other `src` branch failing loudly rather
than silently resolving to empty content.

**A fourth tag, `<MarkdownHTML>`** (EXAMPLE), shows the two approaches
composing rather than competing: it's a genuinely new tag (its own
`RESERVED_TAGS` entry, its own required-`src` validation, normalizes to
`"file"` the same way `<IPFS>` does) built entirely from *existing* pieces
-- it calls `loadSrc()` itself, so `src` can be a local path, `https://`,
`ipfs://`, anything the other branches already support, then pipes the
result through the pre-existing `markdownToHtml()` runtime helper:

```tsx
<MarkdownHTML name="post.html" src="post.md" />
<MarkdownHTML name="readme.html" src="ipfs://bafybeig.../README.md" />
```

Named `MarkdownHTML`, not `Markdown` -- the tag name says what it
*produces*, not just what it reads. Binary content or a code-module `src`
throws a clear error rather than feeding garbage into `marked`.

## Runtime API

- `linkTo(target, options?)` -- a reference to another `File` node, aware of
  where both ultimately land (an in-page anchor if inlined together, a
  relative path/URL otherwise).
- `warn(message)` -- a non-fatal build warning (thrown errors are still
  reserved for fatal problems).
- `glob(pattern)` -- one-off file matching, no caching.
- `useCollection(pattern)` -- same as `glob()`, but registers a build
  dependency so incremental rebuilds invalidate correctly when a matched file
  changes.
- `markdownToHtml(text)` -- renders markdown to an HTML string (a thin, synchronous
  wrapper around `marked`). Convenience only, not a new mechanism -- content
  transformation is otherwise just calling any function you like inline,
  e.g. `{myOwnTransform(text)}`, with no fileable involvement at all.

## CLI

```
fileable build <template> [options]
fileable clean [dir] [options]
fileable eject <path> [options]

  -o, --out-dir <dir>     Directory artifacts are written into (default for
                          build: the template file's own directory; default
                          for clean: [dir] or ".")
  -c, --cwd <dir>         Base directory for resolving relative src/from paths
                          (build only; default: same as --out-dir)
      --var <key[:type]=value>
                          Pass a value to a template function (repeatable, build only)
      --allow-exec        Allow the `cmd` attribute to execute shell commands
      --strict            Promote symlink-fallback warnings to hard errors
      --no-cache          Force a full rebuild, ignoring .fileable-lock.json
      --lock-file <path>  Path to the incremental-build lock file
      --dry-run           Report what would happen without touching disk
      --out <file>        eject only: write generated source here instead of stdout
      --content-mode <infer|inline|ref|ask>
                          eject only: how to decide, per file, whether its
                          content is inlined or referenced (default: infer)
      --content <glob>=<inline|ref>
                          eject only: force a mode for matching files (repeatable)
      --binary-mode <ref|base64>
                          eject only: how binary content resolves to "inline"
                          (default: ref -- inlining binary throws unless this
                          is "base64", which inlines it as a base64 File prop)
      --copy-assets       eject only: copy referenced files into assets/ next
                          to --out instead of pointing at their original location
```

`<template>` is any module whose default export is a fileable tree. Like
`src="partials/x.jsx"` on `File`, it needs to already be compiled to plain
JS (or loadable via a registered Node loader) -- there's no JSX/TS transform
built in, so point the CLI at `.js`, not `.tsx`.

### `clean` -- build's dual

`fileable clean [dir]` removes exactly what a previous `fileable build`
wrote, using `.fileable-lock.json`'s own record of that (not a guess at
what "looks generated"), then removes the lock file itself:

```sh
fileable build template.js   # writes dist/index.html, dist/assets.zip, ...
fileable clean .             # removes exactly those, plus .fileable-lock.json
```

`[dir]` (default `.`) must be the *same* directory `build`'s `--out-dir`
was (or its default, the template's own directory) -- not a subfolder your
tree's own `<Dir name="...">` happens to create inside it, since paths in
the lock file are recorded relative to `[dir]` itself, not to that subfolder.

### `eject` -- build's other dual

`build` turns a JSX tree into a real filesystem tree. `fileable eject
<path>` runs that in reverse: it walks a real path and prints the fileable
TSX source that would build it. `fileable build`'s own output is a
reasonable input to `eject`, and vice versa -- round-tripping recreates the
same tree, byte-for-byte, including binary files:

```sh
fileable eject dist                    # prints generated source to stdout
fileable eject dist --out dist.tsx     # writes it to a file instead
```

```
$ fileable eject dist
import { Dir, File } from "@johnhenry/fileable";

export default (
  <Dir name="dist">
    <File name="hello.txt">{`Hello, world!
`}</File>
    <File name="logo.png" src="./dist/logo.png" />
  </Dir>
);
```

For every file, `eject` decides whether its content is **inlined** as
source text or **referenced** via `src="..."` pointing back at the real
file -- that's `--content-mode`, default `infer`: text inlines, binary
references (it sniffs bytes the same UTF-8 round-trip check that makes
`src`/`cmd` binary-safe already uses, so this is free). Force one mode for
everything with `--content-mode inline|ref` (forcing `inline` on binary
content throws -- there's no safe way to put raw bytes into source text),
or override specific files with `--content <glob>=inline|ref`, checked
before the global mode. `--content-mode ask` prompts interactively for each
*text* file instead of guessing (binary content is never asked about --
`ref` is its only valid answer).

Binary content that resolves to "inline" is, by default, a hard error
(`--content-mode inline` forcing it, or `--content <glob>=inline` matching
a binary file) -- there's no safe way to put raw bytes into source text.
`--binary-mode base64` changes that: binary content inlines as
`<File base64="...">` instead of throwing, so `eject --content-mode inline
--binary-mode base64` produces one self-contained source file with no
`src="..."` references at all, byte-exact round-trippable through `build()`
with nothing left on disk to point back at.

Referenced files are **not copied** by default -- `src` points at the real
file in its original location, computed relative to wherever the generated
source is meant to live (`--out`, or its default: a sibling `<name>.tsx`
next to the ejected path). Pass `--copy-assets` to copy referenced files
into an `assets/` directory next to `--out` instead, for a template that
can survive being moved independently of the tree it was ejected from.

Not captured: file mode/permission bits, and the `useCollection`/`linkTo`
authoring-time relationships that produced a tree in the first place --
`eject` reconstructs structure and content, not how you got there.

The SDK equivalent is `reflect(path, options)`, returning the generated
source as a string; the interactive prompt is CLI-only, so an SDK caller
using `contentMode: "ask"` must supply its own `onAsk(file)` callback.

### `--dry-run` -- preview without touching disk

Works on both commands. Runs the same pipeline (through Hash for `build`,
the same lock-file read for `clean`) and reports exactly what *would*
happen -- written/skipped/removed -- without creating, modifying, or
deleting anything, including the lock file itself:

```sh
fileable build template.js --dry-run
fileable clean . --dry-run
```

### Passing variables with `--var`

A template's default export can be a **function** instead of a tree --
`(vars) => <Dir>...` -- and the CLI will call it with an object built from
every `--var` flag:

```tsx
export default function template(vars: { name?: string } = {}) {
  return <File name="hello.txt">Hello, {vars.name ?? "world"}!</File>;
}
```

```sh
fileable build template.js --var name=Ada
```

`key[:type]=value` uses a TypeScript-like type annotation to control how the
string on the command line gets coerced before it reaches the template --
`type` is one of `string` (the default), `number`, `boolean`, or `json`:

```sh
fileable build template.js \
  --var title="Hello World" \
  --var count:number=3 \
  --var draft:boolean=false \
  --var tags:json='["a","b"]'
```

`--var draft` / `--var draft:boolean` with no `=value` is shorthand for
`true`. `--var` on a template whose default export is a plain tree (not a
function) is ignored with a warning, not an error.

## Examples

Three more from [`examples/`](./examples), each trimmed to its
illustrative core (full source, including partials and content files, is
in the linked directory) with the tree `fileable build` actually produced.

### Blog with an index (`examples/02-blog-with-index`)

`linkTo()` computing a correct relative path, `markdownToHtml()` rendering post
bodies, and `symlink` pointing at the actual generated `<File>` for the
latest post:

```tsx
import { Dir, File, Rm, linkTo, markdownToHtml, useCollection } from "@johnhenry/fileable";

const posts = useCollection("content/posts/*.md")
  .map(parseFrontmatter)
  .sort((a, b) => (a.date < b.date ? 1 : -1)); // newest first

const postFiles = posts.map((post) => (
  <File name={`${post.slug}.html`} doctype="html">
    <h1>{post.title}</h1>
    {markdownToHtml(post.body)}
  </File>
));

const template = (
  <Dir name="dist">
    <Dir name="posts">{postFiles}</Dir>
    <File name="index.html" doctype="html">
      <ul>
        {posts.map((post, i) => (
          <li><a href={linkTo(postFiles[i])}>{post.title}</a></li>
        ))}
      </ul>
    </File>
    <File name="latest" symlink={postFiles[0]} />
    <Rm target="*.draft.html" />
  </Dir>
);

export default template;
```

```
dist/
├── index.html                      <a href="posts/second-post.html">, ...
├── latest -> posts/second-post.html   (real symlink)
└── posts/
    ├── hello-world.html
    └── second-post.html
```

### The same content as a zip, a Web Bundle, *and* a single page (`examples/03-docs-archive-and-single-page`)

The same three `src` references feed an `encode="zip"` `.zip` and an `encode="wbn"`
`.wbn` of standalone pages, plus, via nameless inlining, a
`join="dom-merge"` page that folds all three `<head>`s into one instead of
duplicating `<html>`/`<head>` tags:

```tsx
import { Dir, File } from "@johnhenry/fileable";

const docs = [
  { slug: "getting-started", src: "docs-src/getting-started.js" },
  { slug: "configuration", src: "docs-src/configuration.js" },
  { slug: "faq", src: "docs-src/faq.js" },
];

const template = (
  <Dir name="dist">
    <Dir name="docs-zip" encode="zip">
      {docs.map((doc) => <File name={`${doc.slug}.html`} src={doc.src} />)}
    </Dir>
    <Dir name="docs-wbn" encode="wbn">
      {docs.map((doc) => <File name={`${doc.slug}.html`} src={doc.src} />)}
    </Dir>
    <File name="docs-single-page.html" join="dom-merge">
      {docs.map((doc) => <File src={doc.src} />)}
    </File>
  </Dir>
);

export default template;
```

```
dist/
├── docs-zip.zip
│   ├── getting-started.html
│   ├── configuration.html
│   └── faq.html
├── docs-wbn.wbn                readable via @johnhenry/packfile's fromArchive()
│   ├── getting-started.html    or served directly via its createRouter()
│   ├── configuration.html
│   └── faq.html
└── docs-single-page.html      one <head> merged from all three pages'
```

### An append-only build log (`examples/04-build-log`)

```tsx
import { Dir, File } from "@johnhenry/fileable";

export default function template(vars: { message?: string } = {}) {
  const line = `[${new Date().toISOString()}] ${vars.message ?? "build ran"}\n`;
  return (
    <Dir name="dist">
      <File name="build-log.txt" onConflict="append">{line}</File>
    </Dir>
  );
}
```

Run twice (`fileable build template.js`, then again with
`--var message="second run"`) and `dist/build-log.txt` contains both:

```
[2026-09-18T10:59:03.835Z] build ran
[2026-09-18T10:59:03.903Z] second run
```

## Security

The `cmd` attribute shells out and uses its stdout as file content. It's
disabled unless `render(tree, { allowExec: true })` is set explicitly --
without that flag, encountering `cmd` throws immediately.

## Migrating from v1

- The three companion packages (`fileable-component-file/folder/clear`) and
  the `fileable-iterator` protocol package are gone -- everything lives in
  this one package now.
- The `react`/`react-dom` dependency is gone -- fileable ships its own JSX
  runtime (`@johnhenry/fileable/jsx-runtime`), selected via a `@jsxImportSource @johnhenry/fileable`
  pragma or `compilerOptions.jsxImportSource`.
- The `FILE`/`FOLDER`/`CLEAR` yieldable directives are replaced by the
  `File`/`Dir`/`Rm` JSX components (`import { File, Dir, Rm } from
  "fileable"`). `WARNING`/`ERROR` directives are replaced by a plain `throw`
  (fatal) or the `warn()` helper (non-fatal).

## Design background

The full v2 design PRD (primitives, the five-stage evaluation pipeline,
composition rules, caching, and security model) is tracked in the project
history; the source layout under [`src/`](./src) mirrors its stages directly
(`build.ts` -> `resolve.ts` -> `layout.ts` -> `hash.ts` ->
`write/{loose,archive,packfile}.ts`).

## License

MIT
