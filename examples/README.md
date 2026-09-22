# fileable examples

Runnable TSX templates, each trimmed to its illustrative core in the main
README and shown here in full. They compile alongside `src/`/`bin/` (see
`tsconfig.json`'s `include`), so `npm run build` typechecks every example
the same way it typechecks the library itself -- an example that no longer
compiles against the current API fails the build, not just a manual read.

| Example | Demonstrates |
| --- | --- |
| [`01-hello-world/template.tsx`](./01-hello-world/template.tsx) | The minimal `Dir`/`File` tree, plus a template whose default export is a **function** of `--var` values instead of a plain tree. |
| [`02-blog-with-index/template.tsx`](./02-blog-with-index/template.tsx) | `useCollection()` registering a build dependency on `content/posts/*.md`, `linkTo()` computing a correct relative path between generated files, `markdownToHtml()` rendering post bodies, and `symlink` pointing at the actual generated `<File>` for the latest post. |
| [`03-docs-archive-and-single-page/template.tsx`](./03-docs-archive-and-single-page/template.tsx) | The same three `src` references feeding an `encode="zip"` archive, an `encode="wbn"` Web Bundle, and (via nameless inlining + `join="dom-merge"`) one concatenated page with a single merged `<head>` -- one authored tree, three materializations, no rewriting. |
| [`04-build-log/template.tsx`](./04-build-log/template.tsx) | `onConflict="append"`: run the same template twice and `dist/build-log.txt` accumulates a line per run instead of being clobbered by the default `"replace"` behavior. |
| [`05-ipfs-src/template.tsx`](./05-ipfs-src/template.tsx) + [`run.mjs`](./05-ipfs-src/run.mjs) | Two differently-sized answers to "how do I add a new content source" side by side: `<File src="ipfs://...">` (one more branch on the existing `src` prop) and `<IPFS>` (a genuinely new, independently-reserved tag) producing byte-identical output. `run.mjs` points `ipfsGateway` at a real local `node:http` server standing in for a public IPFS gateway -- verified directly, not assumed: every major public gateway (`ipfs.io`, `dweb.link`, `w3s.link`, `nftstorage.link`) currently rejects a direct server-side fetch with `429`. |

## Running

Every example is typechecked and compiled by `npm run build` (it's part of
`tsconfig.json`'s `include`). Only `05-ipfs-src` ships a standalone driver
script today (`run.mjs`) -- the others are demonstrated by building their
template through the CLI directly:

```sh
npm run build
node dist/bin/fileable.js build dist/examples/01-hello-world/template.js
node dist/bin/fileable.js build dist/examples/01-hello-world/template.js --var name=Ada

npm run build && node examples/05-ipfs-src/run.mjs   # the one with a real driver script
```

`--dry-run` previews any of them without touching disk:
`node dist/bin/fileable.js build dist/examples/04-build-log/template.js --dry-run`.

## Runtime requirements (honest edition)

All five run under plain Node >= 26, no browser needed -- `fileable build`
is a CLI/Node-only tool; there is no browser build of this package.
`05-ipfs-src` opens a real (loopback-only) HTTP server on an OS-assigned
port for the duration of the run; it does not reach the network otherwise.
