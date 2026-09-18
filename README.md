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
(`<dir>`, `<file>`, `<rm>`), content-hash layer caching
(`.fileable-lock.json`), and three interchangeable output shapes (a folder of
loose files, a zip archive, or one concatenated file) from the same authored
tree.

## Installation

```sh
npm install fileable
```

## Quick example

```tsx
/** @jsxImportSource fileable */
import { render } from "fileable";

const template = (
  <dir name="dist">
    <file name="hello.txt">Hello, world!</file>
  </dir>
);

await render(template, { outDir: "." });
```

See [`examples/`](./examples) for a runnable hello-world, a blog-with-index
example (adapted from the design PRD below), and a docs-archive-and-single-page
example showing the same authored content rendered as both a `.zip` archive
and one `join="dom-merge"` page.

## The three primitives

| Element | Purpose |
|---|---|
| `<dir>` | A directory. `name`, `from` (glob -> one child per match), `as="loose" \| "archive"`, `mode`. |
| `<file>` | A file, or -- nested inside another `<file>` -- a content fragment to inline. `name`, `src`, `doctype`, `mode`, `symlink`, `cmd`, `join="concat" \| "dom-merge"`. |
| `<rm>` | A removal. `target` (glob, supports `!` negation). |

Any other JSX tag (`<h1>`, `<ul>`, `<a>`, ...) is plain markup content, not a
fileable primitive -- it's stringified into whichever `<file>` contains it.

A `<file>` or `<dir>` nested inside another `<file>` isn't a separate path --
it's folded into the parent's content (nameless inlining). This single rule
is what lets the same authored tree render as loose files, a zip archive, or
one concatenated file, just by choosing where the nesting happens and
whether `as="archive"` is set.

## Runtime API

- `link(target, options?)` -- a reference to another `<file>` node, aware of
  where both ultimately land (an in-page anchor if inlined together, a
  relative path/URL otherwise).
- `warn(message)` -- a non-fatal build warning (thrown errors are still
  reserved for fatal problems).
- `glob(pattern)` -- one-off file matching, no caching.
- `useCollection(pattern)` -- same as `glob()`, but registers a build
  dependency so incremental rebuilds invalidate correctly when a matched file
  changes.

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
- The `FILE`/`FOLDER`/`CLEAR` yieldable directives are replaced by
  `<file>`/`<dir>`/`<rm>` JSX elements. `WARNING`/`ERROR` directives are
  replaced by a plain `throw` (fatal) or the `warn()` helper (non-fatal).

## Design background

The full v2 design PRD (primitives, the five-stage evaluation pipeline,
composition rules, caching, and security model) is tracked in the project
history; the source layout under [`src/`](./src) mirrors its stages directly
(`build.ts` -> `resolve.ts` -> `layout.ts` -> `hash.ts` ->
`write/{loose,archive}.ts`).

## License

MIT
