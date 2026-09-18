# fileable

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
and three interchangeable output shapes (a folder of loose files, a zip
archive, or one concatenated file) from the same authored tree.

## Installation

```sh
npm install fileable
```

## Quick example

```tsx
/** @jsxImportSource fileable */
import { Dir, File } from "fileable";

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

`outDir`/`cwd` default to the template file's own directory. Prefer to drive
it yourself instead of via the CLI? `render()` is a plain function --
`import { render } from "fileable"; await render(template, { outDir: "." })`.

See [`examples/`](./examples) for a runnable hello-world, a blog-with-index
example (adapted from the design PRD below), and a docs-archive-and-single-page
example showing the same authored content rendered as both a `.zip` archive
and one `join="dom-merge"` page.

## The three primitives

`Dir`/`File`/`Rm` are ordinary functions exported from `"fileable"` --
`import { Dir, File, Rm } from "fileable"` and use them as JSX components
(`<File name="a.txt">...</File>`) or call them directly with no JSX at all
(`File({ name: "a.txt" })`). The bare lowercase `<dir>`/`<file>`/`<rm>` tags
are **reserved and throw** if written directly (a clear error pointing at
the correct import) -- they're not a shortcut, so there's always one real,
importable, "go to definition"-able symbol for each primitive rather than a
string matched somewhere inside the JSX runtime.

| Component | Purpose |
|---|---|
| `Dir` | A directory. `name`, `from` (glob -> one child per match), `as="loose" \| "archive"`, `mode`. |
| `File` | A file, or -- nested inside another `File` -- a content fragment to inline. `name`, `src`, `doctype`, `mode`, `symlink`, `cmd`, `join="concat" \| "dom-merge"`. |
| `Rm` | A removal. `target` (glob, supports `!` negation). |

Any other JSX tag (`<h1>`, `<ul>`, `<a>`, ...) is plain markup content, not a
fileable primitive -- it's stringified into whichever `File` contains it.
Only `dir`/`file`/`rm` are reserved; any other lowercase tag name is fine to
use directly, exactly as shown in the examples.

A `File` or `Dir` nested inside another `File` isn't a separate path -- it's
folded into the parent's content (nameless inlining). This single rule is
what lets the same authored tree render as loose files, a zip archive, or
one concatenated file, just by choosing where the nesting happens and
whether `as="archive"` is set.

## Runtime API

- `link(target, options?)` -- a reference to another `File` node, aware of
  where both ultimately land (an in-page anchor if inlined together, a
  relative path/URL otherwise).
- `warn(message)` -- a non-fatal build warning (thrown errors are still
  reserved for fatal problems).
- `glob(pattern)` -- one-off file matching, no caching.
- `useCollection(pattern)` -- same as `glob()`, but registers a build
  dependency so incremental rebuilds invalidate correctly when a matched file
  changes.
- `markdown(text)` -- renders markdown to an HTML string (a thin, synchronous
  wrapper around `marked`). Convenience only, not a new mechanism -- content
  transformation is otherwise just calling any function you like inline,
  e.g. `{myOwnTransform(text)}`, with no fileable involvement at all.

## CLI

```
fileable build <template> [options]

  -o, --out-dir <dir>   Directory artifacts are written into
                         (default: the template file's own directory)
  -c, --cwd <dir>        Base directory for resolving relative src/from paths
                         (default: same as --out-dir)
      --allow-exec       Allow the `cmd` attribute to execute shell commands
      --strict           Promote symlink-fallback warnings to hard errors
      --no-cache          Force a full rebuild, ignoring .fileable-lock.json
      --lock-file <path> Path to the incremental-build lock file
```

`<template>` is any module whose default export is a fileable tree. Like
`src="partials/x.jsx"` on `File`, it needs to already be compiled to plain
JS (or loadable via a registered Node loader) -- there's no JSX/TS transform
built in, so point the CLI at `.js`, not `.tsx`.

## Security

The `cmd` attribute shells out and uses its stdout as file content. It's
disabled unless `render(tree, { allowExec: true })` is set explicitly --
without that flag, encountering `cmd` throws immediately.

## Migrating from v1

- The three companion packages (`fileable-component-file/folder/clear`) and
  the `fileable-iterator` protocol package are gone -- everything lives in
  this one package now.
- The `react`/`react-dom` dependency is gone -- fileable ships its own JSX
  runtime (`fileable/jsx-runtime`), selected via a `@jsxImportSource fileable`
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
`write/{loose,archive}.ts`).

## License

MIT
