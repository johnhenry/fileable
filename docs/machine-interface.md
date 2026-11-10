# fileable machine interface

How a program (Sitefile Desktop, an editor plugin, a CI script, a test
harness) drives fileable through its CLI: `--json` events, error and exit
codes, `fileable watch`, the project manifest, loading `.ts`/`.tsx`
templates, and running under Node's permission model. Requires Node 26 or
later. Added in johnhenry/fileable#25.

The envelope, the shared events (`warning`, `error`, `reloading`,
`stopping`, `stopped`) and the shared exit codes are the same as
`@johnhenry/servable`'s and `@johnhenry/hostable`'s `--json` output, so one
parser can read all three. Build-specific events (`start`, `file`, `done`,
`watching`, `manifest`, `version`) are fileable's own.

## Commands

```sh
fileable build   [template] [--project <dir>] [options] [--json]
fileable watch   [template] [--project <dir>] [--debounce <ms>] [options] [--json]
fileable clean   [dir] [--project <dir>] [--json]
fileable eject   <path> [--out <file>] [--json]
fileable manifest [dir] [--json]
fileable --version [--json]
```

With no `template`, `build` and `watch` read the project manifest in
`--project` (default: the current directory). Giving both a template and
`--project` is a usage error.

## Events (`--json`)

With `--json`, stdout carries only events, one JSON object per line
(NDJSON). Everything else goes to stderr, including whatever the template
itself prints with `console.log`/`console.info`/`process.stdout.write`
while it loads and renders, and Node's own warnings. Without `--json`,
output is the human text fileable always printed.

Every event has the same envelope:

```json
{"v":1,"event":"start","time":"2026-11-10T20:40:29.886Z", ...fields}
```

- `v` is the schema version, currently `1`. It changes only for an
  incompatible change: a field removed or retyped. New events and new
  fields don't change it, so ignore what you don't recognize.
- `event` is the event name.
- `time` is an ISO-8601 timestamp.

### Event reference

| Event | Fields | When |
| --- | --- | --- |
| `start` | `command`, `template`, `manifest`?, `outDir`, `cwd`, `dryRun`, `cache`, `fileable` (version), `node` (version); under watch also `build` (1, 2, ...) and `trigger` `{reason: "initial" \| "change", paths}` | A build (or `clean`/`eject`) begins. |
| `file` | `path`, `action`, and for builds `kind` (`file`/`dir`), `encode` (`loose`/`zip`/`wbn`), `hash`, `root` | One per output. `action` is `written`, `unchanged` (lock-file cache hit), `skipped` (`onConflict="skip"` left an existing file alone) or `removed` (`<Rm>`, or `clean`). `path` is relative to `outDir`, with `/` separators. A `.zip`/`.wbn` is one `file` (its entries aren't listed). `hash` is the value in `.fileable-lock.json`. `root` is true for top-level outputs. |
| `warning` | `message`, `code` | Something worth knowing that doesn't fail the build. Codes below. |
| `error` | `code`, `message`, `fatal`, `exitCode`, and sometimes `path`, `permission`, `resource`, `causes` | Something failed. `fatal: true` means the run ends (with `done` for a build, then `stopped`). Under `watch` a failed build has `fatal: false` and watching continues. |
| `done` | `command`, `ok`, `exitCode`, `durationMs`, `dryRun`, `counts` `{written, unchanged, skipped, removed, warnings}`; on success `buildHash` and `output` `{outDir, shape, roots: [{path, kind, encode, hash}]}`; under watch `build`; for `eject` without `--out`, `source` | Exactly one per `start`. |
| `watching` | `paths` | `watch`: the first build is done and the watcher is running. |
| `reloading` | `files` | `watch` saw a change (paths relative to the project directory). Exactly one build follows: one `start`, one `done`. |
| `stopping` | `signal` | `watch` got SIGINT or SIGTERM (`"abort"` for the SDK's AbortSignal). A build already running finishes first. |
| `stopped` | `exitCode` | Always the last line of every command. |
| `manifest` | `path`, `source` (`fileable.config.json` / `package.json`), `manifest` | `fileable manifest --json`. |
| `version` | `fileable`, `node`, `eventsSchemaVersion` | `fileable --version --json`. |

`buildHash` is a sha256 over every artifact's id and content hash. It's the
same for two builds with the same output, whether or not anything was
rewritten, so an app can tell "nothing changed" without diffing files.

`output.shape` is the encode shared by every root (`loose`, `zip`, `wbn`),
`mixed` if they differ, or `empty` with no outputs.

### A build, start to finish

```json
{"v":1,"event":"start","time":"…","command":"build","template":"/p/template.tsx","manifest":"/p/fileable.config.json","outDir":"/p/out","cwd":"/p/out","dryRun":false,"cache":true,"fileable":"0.1.1","node":"v26.11.1"}
{"v":1,"event":"file","time":"…","path":"site","action":"written","kind":"dir","encode":"loose","hash":"sha256:91fa…","root":true}
{"v":1,"event":"file","time":"…","path":"site/index.html","action":"written","kind":"file","encode":"loose","hash":"sha256:8741…","root":false}
{"v":1,"event":"done","time":"…","command":"build","ok":true,"exitCode":0,"durationMs":25,"dryRun":false,"counts":{"written":2,"unchanged":0,"skipped":0,"removed":0,"warnings":0},"buildHash":"db01…","output":{"outDir":"/p/out","shape":"loose","roots":[{"path":"site","kind":"dir","encode":"loose","hash":"sha256:91fa…"}]}}
{"v":1,"event":"stopped","time":"…","exitCode":0}
```

A failed build:

```json
{"v":1,"event":"start", …}
{"v":1,"event":"error","time":"…","code":"E_MODULE_NOT_FOUND","message":"template \"nope.js\" not found (at /p/nope.js)","fatal":true,"exitCode":3,"path":"/p/nope.js"}
{"v":1,"event":"done","time":"…","command":"build","ok":false,"exitCode":3, …}
{"v":1,"event":"stopped","time":"…","exitCode":3}
```

A usage or manifest error has no `start` or `done`: just `error`, then
`stopped`.

## Error codes and exit codes

Every error has a stable `E_*` code, in `--json` `error` events and in text
mode (`fileable: error E_CODE: message` on stderr). Codes are only ever
added, never renamed or given a new meaning. The SDK exposes the same
codes: `FileableError.code`, `ERROR_CODES` and `describeError()` from
`@johnhenry/fileable`.

| Exit | Codes | Meaning |
| --- | --- | --- |
| 0 | | Success. `watch` stopped by a signal also exits 0. |
| 1 | `E_INTERNAL` | An unexpected error (probably a fileable bug). |
| 1 | `E_INVALID_TREE`, `E_INVALID_PROP`, `E_INVALID_OPTION`, `E_PATH_CONFLICT`, `E_UNSAFE_PATH`, `E_CONFLICT`, `E_SRC`, `E_DECODE`, `E_UNSAFE_ENTRY`, `E_EXEC_DENIED`, `E_EXEC_FAILED`, `E_SYMLINK`, `E_LINK`, `E_RM`, `E_EJECT_BINARY`, `E_BROWSER_UNSUPPORTED` | The build failed; the code says why (see below). |
| 2 | `E_USAGE`, `E_MANIFEST` | Bad command line, or the manifest is missing, invalid or ambiguous. |
| 3 | `E_MODULE_NOT_FOUND`, `E_MODULE_LOAD`, `E_JSX_COMPILER`, `E_NOT_A_TEMPLATE` | The template couldn't be loaded. Not fatal under `watch`. |
| 5 | `E_ACCESS_DENIED` | Node's permission model refused something. `permission` names the scope, and the message names the `--allow-*` flag to add. |

Exit code 4 is not used by fileable (it's servable's `E_LISTEN`).

| Code | Meaning |
| --- | --- |
| `E_USAGE` | Unknown command or option, a missing option value, `--content-mode ask` with `--json`. |
| `E_MANIFEST` | No manifest where one is needed, invalid JSON, an unknown key, a wrong type, or both `fileable.config.json` and a package.json `"fileable"` field. |
| `E_MODULE_NOT_FOUND` | The template file doesn't exist. |
| `E_MODULE_LOAD` | The template (or something it imports) threw while loading, or its default-export function threw. |
| `E_JSX_COMPILER` | A `.tsx`/`.jsx` module, and no JSX compiler fileable can use in the project. |
| `E_NOT_A_TEMPLATE` | The template module has no default export. |
| `E_INVALID_TREE` | A Promise or binary value as a JSX child, or a reserved lowercase tag. |
| `E_INVALID_PROP` | A required prop is missing (`name`, `src`), or `encode`/`decode`/`join`/`onConflict`/`kind`/`onMissing`/`base64` has an invalid value. |
| `E_INVALID_OPTION` | An SDK option is invalid (eject modes, `encode` with a root that isn't a `<Dir>`). |
| `E_PATH_CONFLICT` | Two artifacts resolve to the same output path; or two paths differ only in case or Unicode normalization (`A.txt`/`a.txt`, NFC/NFD), which is one file on macOS and Windows, so it is refused on every platform; or an artifact would be written inside a path the same build writes as a file, symlink or archive (`link` and `link/x`). Checked before anything is written. |
| `E_UNSAFE_PATH` | An output path would leave `outDir`. Before anything is written: a template name or `<Rm target>` that, after joining, has a `..` climbing out, is absolute or has a drive letter, a backslash, a control character, or an empty, `.` or dots-and-spaces segment (the `E_UNSAFE_ENTRY` rule), or an `encode="zip"`/`"wbn"` entry name like that (the archive would be unsafe to extract). While writing: a write, `<Dir mode>` or `<Rm>` would go through a symlink or junction already in `outDir` that leads outside it (or doesn't resolve), or `append`/`prepend` would write through such a link or a hard link. The message ends with the reason. Also: `toFiles()` produced an empty, absolute or escaping path. |
| `E_CONFLICT` | `onConflict="error"` found an existing file, or `append`/`prepend` on a symlink. |
| `E_SRC` | A `src`/`from`/prop value couldn't be read, fetched or awaited. |
| `E_DECODE` | `<Dir src decode>` couldn't decode the archive, or couldn't read an entry (encrypted, unsupported compression, truncated). |
| `E_UNSAFE_ENTRY` | `<Dir src decode>` found an entry that could land outside the `<Dir>`: a `..` segment, an absolute path or drive letter, a backslash, a control character (including NUL), an empty, `.` or dots-and-spaces segment; for `zip`, also a symlink, a device/FIFO, or a duplicate name; for `wbn`, also a query/fragment, a malformed `%` escape, or a URL outside the bundle's root. The message ends with the reason in parentheses. Nothing from the archive is written. |
| `E_EXEC_DENIED` | `cmd` without `--allow-exec`. |
| `E_EXEC_FAILED` | The `cmd` command failed. |
| `E_SYMLINK` | A symlink can't be made, or `--strict` refused a copy fallback. |
| `E_LINK` | A `linkTo()` target isn't in the tree. |
| `E_RM` | `<Rm onMissing="error">` matched nothing, or `deletable()` threw. |
| `E_EJECT_BINARY` | `eject` asked to inline binary content as text. |
| `E_BROWSER_UNSUPPORTED` | The browser entry point can't do this. |
| `E_ACCESS_DENIED` | Node's permission model refused a read, write or child process. |
| `E_INTERNAL` | Anything else. |

Warning codes (never fail the build): `E_WARN` (the template called
`warn()`), `E_SYMLINK_FALLBACK` (a symlink was written as a copy),
`E_RM_NO_MATCH` (`<Rm onMissing="warn">` matched nothing),
`E_CACHE_UNREADABLE` (the lock file isn't readable under the permission
model, so every build is a full rebuild), `E_VARS_IGNORED` (`--var` given
but the template isn't a function), `E_WATCH` (the file watcher reported an
error).

## `fileable watch`

Builds once, emits `watching`, then rebuilds whenever a file under the
project changes, until SIGINT or SIGTERM.

- It watches the template's directory (or the manifest's project directory),
  plus `cwd` if that's outside it, recursively.
- It ignores `node_modules`, `.git`, the lock file, the output directory
  when it's a separate folder inside the project, every path the previous
  build wrote, and the manifest's `watch.ignore` globs. A build never
  triggers itself.
- Changes are debounced (`--debounce`, or the manifest's
  `watch.debounceMs`; default 100 ms). Changes during a build queue one more
  build.
- It uses the lock-file cache, so unchanged outputs aren't rewritten and are
  reported as `unchanged`.
- The template and its partials are re-imported fresh on every rebuild.
  Modules in `node_modules` aren't.
- A failing build reports `error` (`fatal: false`) and `done` (`ok: false`)
  and watching continues; the next change retries.

What it doesn't do: it's a re-import in one process, not a restart, so
timers or sockets a template opens at module level keep running, and each
rebuild keeps the old module copies in memory. Restart the process to reset
those. On Windows there's no catchable SIGTERM, so a supervisor's kill stops
it at once, without `stopping`/`stopped`.

## Project manifest

A project names its template and settings in `fileable.config.json`, or a
`"fileable"` field in `package.json`, in the project directory:

```json
{
  "template": "src/site.tsx",
  "outDir": "dist",
  "cwd": "content",
  "vars": { "title": "My site" },
  "encode": "loose",
  "strict": false,
  "cache": true,
  "lockFile": ".fileable-lock.json",
  "ipfsGateway": "https://ipfs.io/ipfs/",
  "watch": { "debounceMs": 100, "ignore": ["drafts/**"] }
}
```

- `template` is required. Paths are relative to the project directory.
- `outDir` defaults to the template's directory; `cwd` to `outDir`.
- `vars` are passed to a template function; `--var` flags override them
  key by key.
- `encode` is the default encode for root `<Dir>`s that don't set their
  own. A root's own `encode` wins. `zip`/`wbn` with a root that isn't a
  `<Dir>` is an error.
- Command-line flags override the manifest.
- Only the project directory is checked, not its parents. Both files
  defining a manifest is `E_MANIFEST`, not a precedence rule.
- Unknown keys are `E_MANIFEST`. `"$schema"` is allowed and ignored.
- **`allowExec` is not a manifest key.** Opening a project must never be
  enough to let it run shell commands; pass `--allow-exec` yourself.

`fileable manifest [dir] --json` prints the manifest fileable would use.

## Loading `.ts` and `.tsx` templates

Node 26 strips TypeScript types itself, so `.ts`/`.mts` templates (and
partials) load with no compile step. Write them with the JSX-free builders:

```ts
import { dir, file } from "@johnhenry/fileable";
const title: string = "Hello";
export default dir("site", [file("index.html", `<h1>${title}</h1>`)]);
```

Node does not parse JSX, and its `module.stripTypeScriptTypes()` has no
transform mode, so `.tsx`/`.jsx` needs a compiler. fileable doesn't bundle
one; the CLI uses whichever of these the template's project has installed
(resolved from the template's location), in this order:

1. `typescript` 5.x or 6.x (`transpileModule()`). Pure JavaScript, so it
   also works under the permission model with no extra grants.
2. `esbuild` (`transformSync()`). It runs esbuild's native binary from a
   worker thread, so under the permission model it needs both
   `--allow-child-process` and `--allow-worker`; without them the error is
   `E_ACCESS_DENIED` naming the missing flag.

TypeScript 7 (the native compiler) has no in-process transpile API, so it
doesn't count. With neither installed, a `.tsx`/`.jsx` module fails with
`E_JSX_COMPILER`. The other options are compiling to `.js` first, or `.ts`
with the builders.

The JSX runtime is `@johnhenry/fileable`'s own (`jsx: "react-jsx"`,
`jsxImportSource: "@johnhenry/fileable"`), so templates need no pragma. Any
`@johnhenry/fileable` import in a template resolves to the fileable that is
running the build, even if the project has another copy or none: `warn()`,
`useCollection()` and the JSX runtime keep module-level state, and two
copies would lose it. These loader hooks are CLI-only; `render()` from the
SDK doesn't install them.

## Running under Node's permission model

The CLI runs under `node --permission`. It needs:

- `--allow-fs-read` for the project (template, partials, `src` files), the
  output directory (to read the lock file, check what's already there, and
  check for symlinks that lead outside it),
  and the fileable package with its dependencies (Node reads module files
  through the same check). In a project with fileable in its own
  `node_modules`, the project directory covers it.
- `--allow-fs-write` for the output directory.
- `--allow-child-process` only for `cmd` (with `--allow-exec`), or, together
  with `--allow-worker`, for `.tsx`/`.jsx` compiled by esbuild. With
  `typescript` 5.x/6.x as the compiler, `.tsx` needs no extra grants.

```sh
node --permission \
  --allow-fs-read="$PWD" --allow-fs-read="$PWD/out" --allow-fs-write="$PWD/out" \
  node_modules/@johnhenry/fileable/dist/bin/fileable.js build --json
```

What happens when a grant is missing:

| Missing | Result |
| --- | --- |
| write on `outDir` | Checked before the build starts: `E_ACCESS_DENIED`, exit 5, `permission: "FileSystemWrite"`, message names `--allow-fs-write=<outDir>`. Nothing is written. |
| read on the template / project | `E_ACCESS_DENIED`, exit 5, `permission: "FileSystemRead"`, message names `--allow-fs-read=<path>`. |
| read on `outDir` (write only) | Checked before the build starts: `E_ACCESS_DENIED`, exit 5, `permission: "FileSystemRead"`, message names `--allow-fs-read=<outDir>`. fileable reads `outDir` to check for symlinks before writing into it. |
| read on a `--lock-file` outside `outDir` (write only) | The build works, with an `E_CACHE_UNREADABLE` warning: the lock file can't be read, so every build is a full rebuild. |
| child process, with `--allow-exec` and a `cmd` | Checked before spawning: `E_ACCESS_DENIED`, exit 5, `permission: "ChildProcess"`, message names `--allow-child-process`. |
| read on the fileable package itself | Node can't load the CLI at all; it exits 1 with its own `ERR_ACCESS_DENIED` before any fileable code runs, so there are no events. |

Granting `--allow-child-process` makes Node print a `SecurityWarning` on
stderr; stdout is unaffected.
