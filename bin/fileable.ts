#!/usr/bin/env node
/**
 * `fileable build <template>` imports a template module's default export
 * and renders it, so templates don't each need their own
 * `await render(tree, {...})` boilerplate at the bottom.
 *
 * `outDir`/`cwd` default to the template file's own directory (matching
 * what every hand-written example did before this existed) rather than the
 * invoking shell's cwd, since that's what makes a template's own relative
 * `src`/`from` paths resolve the way its author expects regardless of
 * where `fileable build` is invoked from.
 *
 * A template's default export can be a tree (as before) or a function --
 * `(vars) => <Dir>...` -- in which case `--var` flags are parsed (see
 * vars.ts) and passed in as a single object.
 *
 * `fileable clean [dir]` is build's dual: it removes exactly what a
 * previous build wrote, using `.fileable-lock.json`'s own record of that
 * (not a guess at what "looks generated"), then removes the lock file
 * itself. `--dry-run` (on either command) previews without touching disk.
 *
 * `fileable eject <path>` is build's *other* dual, in the opposite
 * direction: it walks a real filesystem path and prints (or writes) the
 * fileable TSX source that would build it. See src/eject.ts for the
 * content-mode decision (inline vs. reference) this has to make per file;
 * this file only adds the interactive "ask" prompt, since that's a CLI
 * concern the SDK's `reflect()` deliberately doesn't have an opinion on.
 *
 * Machine interface (#25): `--json` turns stdout into NDJSON events
 * (events.ts, docs/events.md), every failure carries a stable error code
 * with a documented exit code (src/errors.ts), `fileable watch` rebuilds on
 * change (watch.ts), `.tsx`/`.jsx` templates load through loader.ts, and a
 * project manifest (manifest.ts) can stand in for the template argument.
 */
import { dirname, relative as relativePath, resolve as resolvePath, sep } from "node:path";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { render } from "../src/render.js";
import { readLockFile } from "../src/lock.js";
import { BINARY_MODES, CONTENT_MODES, reflect } from "../src/eject.js";
import { assertPermitted, describeError, EXIT_OK } from "../src/errors.js";
import { FileableError } from "../src/types.js";
import type { BinaryMode, ContentMode, ContentOverride, EjectFileInfo } from "../src/eject.js";
import type { RenderOptions, RenderTarget, WriteSummary } from "../src/types.js";
import { parseVarFlag } from "./vars.js";
import { Emitter, defaultIo, outputShape, withStdoutToStderr, EVENTS_SCHEMA_VERSION } from "./events.js";
import type { Command, Io } from "./events.js";
import { findManifest } from "./manifest.js";
import type { LoadedManifest } from "./manifest.js";
import { installLoader } from "./loader.js";
import { runWatch } from "./watch.js";

function readVersion(): string {
  try {
    return (JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string }).version;
  } catch {
    return "unknown";
  }
}

export const FILEABLE_VERSION = readVersion();

const HELP = `Usage: fileable build [template] [options]
       fileable watch [template] [options]
       fileable clean [dir] [options]
       fileable eject <path> [options]
       fileable manifest [dir] [--json]
       fileable --version [--json]

build renders a template module's default export -- a fileable JSX tree,
or a function (vars) => <Dir>... that receives --var-supplied values.
With no template, it reads the project manifest (fileable.config.json, or
a "fileable" field in package.json) in --project (default ".").

watch builds, then rebuilds whenever a file in the project changes, using
the same lock-file cache. A failing build is reported and watching
continues. Stop it with Ctrl-C (SIGINT) or SIGTERM.

clean removes exactly what a previous build wrote (from
.fileable-lock.json) plus the lock file itself. [dir] defaults to "." (or
the manifest's outDir) and must be the *same* directory build's --out-dir
was (or its default, the template's own directory) -- not a subfolder your
tree's own <Dir name> happens to create inside it, since that's just an
artifact's output path, recorded in the lock file relative to [dir] itself.

eject walks a real filesystem path and prints the fileable TSX source that
would build it -- build's dual, in the opposite direction. Prints to
stdout by default; pass --out to write it to a file instead. Referenced
(non-inlined) files point back at their original location unless
--copy-assets is given.

manifest prints the project manifest fileable would use in [dir].

Options:
  -o, --out-dir <dir>    Directory artifacts are written into
                          (default for build: the template file's own
                          directory; default for clean: [dir] or ".")
  -c, --cwd <dir>         Base directory for resolving relative src/from paths
                          (build only; default: same as --out-dir)
  -p, --project <dir>     Project directory holding the manifest (build,
                          watch, clean; default ".")
      --var <key[:type]=value>
                          Pass a value to a template function (repeatable,
                          build only). type is one of string (default),
                          number, boolean, json. \`--var draft\` / \`--var
                          draft:boolean\` with no "=value" means true. E.g.:
                            --var title="Hello World"
                            --var count:number=3
                            --var draft:boolean=false
                            --var tags:json='["a","b"]'
      --encode <loose|zip|wbn>
                          Default encode for root <Dir>s that don't set one
      --allow-exec        Allow the \`cmd\` attribute to execute shell commands
      --strict            Promote symlink-fallback warnings to hard errors
      --no-cache          Force a full rebuild, ignoring .fileable-lock.json
      --lock-file <path>  Path to the incremental-build lock file
      --dry-run           Report what would happen without touching disk
      --json              Print NDJSON events on stdout instead of text
                          (schema v${EVENTS_SCHEMA_VERSION}; see docs/machine-interface.md)
      --debounce <ms>     watch only: wait this long after the last change
                          before rebuilding (default 100)
      --out <file>        eject only: write the generated source here
                          instead of printing it to stdout
      --content-mode <infer|inline|ref|ask>
                          eject only: how to decide, per file, whether its
                          content is inlined or referenced via src="...".
                          Default: infer (text inlines, binary references).
                          "ask" prompts interactively for each text file
                          (binary content is always "ref" -- nothing to ask).
      --content <glob>=<inline|ref>
                          eject only: force a mode for files matching glob,
                          overriding --content-mode (repeatable)
      --binary-mode <ref|base64>
                          eject only: how binary content that would
                          otherwise need "ref" is represented. Default:
                          ref (src="..." pointing back at the real file).
                          base64: inline it as base64="..." instead --
                          self-contained, no dependency on the original
                          file's continued existence at that path.
      --copy-assets       eject only: copy referenced files into an
                          assets/ dir next to --out instead of pointing at
                          their original location
  -v, --version           Print the version
  -h, --help              Show this help

Exit codes: 0 ok, 1 build failed or internal error, 2 usage or manifest
error, 3 template couldn't be loaded, 5 denied by Node's permission model.
`;

interface ParsedArgs {
  command?: string;
  positional?: string;
  outDir?: string;
  cwd?: string;
  project?: string;
  vars: Record<string, unknown>;
  varsGiven: boolean;
  encode?: RenderTarget;
  allowExec: boolean;
  strict: boolean;
  cache: boolean;
  dryRun: boolean;
  json: boolean;
  debounceMs?: number;
  lockFile?: string;
  help: boolean;
  version: boolean;
  out?: string;
  contentMode?: ContentMode;
  content: ContentOverride[];
  binaryMode?: BinaryMode;
  copyAssets: boolean;
}

function usage(message: string): never {
  throw new FileableError(message, "<arguments>", undefined, "E_USAGE");
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    vars: {},
    varsGiven: false,
    allowExec: false,
    strict: false,
    cache: true,
    dryRun: false,
    json: false,
    help: false,
    version: false,
    content: [],
    copyAssets: false,
  };
  const positionals: string[] = [];
  const value = (i: number, flag: string): string => {
    const v = argv[i];
    if (v === undefined) usage(`${flag} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "-h":
      case "--help":
        args.help = true;
        break;
      case "-v":
      case "--version":
        args.version = true;
        break;
      case "-o":
      case "--out-dir":
        args.outDir = value(++i, arg);
        break;
      case "-c":
      case "--cwd":
        args.cwd = value(++i, arg);
        break;
      case "-p":
      case "--project":
        args.project = value(++i, arg);
        break;
      case "--var": {
        let parsed: [string, unknown];
        try {
          parsed = parseVarFlag(value(++i, arg));
        } catch (error) {
          if (error instanceof FileableError) throw error;
          usage((error as Error).message);
        }
        args.vars[parsed[0]] = parsed[1];
        args.varsGiven = true;
        break;
      }
      case "--encode": {
        const v = value(++i, arg);
        if (v !== "loose" && v !== "zip" && v !== "wbn") usage(`invalid --encode "${v}" -- expected loose|zip|wbn`);
        args.encode = v;
        break;
      }
      case "--allow-exec":
        args.allowExec = true;
        break;
      case "--strict":
        args.strict = true;
        break;
      case "--no-cache":
        args.cache = false;
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--json":
        args.json = true;
        break;
      case "--debounce": {
        const v = Number(value(++i, arg));
        if (!Number.isFinite(v) || v < 0) usage(`invalid --debounce "${argv[i]}" -- expected a number of milliseconds >= 0`);
        args.debounceMs = v;
        break;
      }
      case "--lock-file":
        args.lockFile = value(++i, arg);
        break;
      case "--out":
        args.out = value(++i, arg);
        break;
      case "--content-mode": {
        const v = value(++i, arg);
        if (!CONTENT_MODES.has(v)) usage(`invalid --content-mode "${v}" -- expected infer|inline|ref|ask`);
        args.contentMode = v as ContentMode;
        break;
      }
      case "--content": {
        const raw = value(++i, arg);
        const eqIndex = raw.lastIndexOf("=");
        const mode = eqIndex === -1 ? "" : raw.slice(eqIndex + 1);
        if (eqIndex === -1 || (mode !== "inline" && mode !== "ref")) {
          usage(`invalid --content "${raw}" -- expected <glob>=inline|ref`);
        }
        args.content.push({ pattern: raw.slice(0, eqIndex), mode });
        break;
      }
      case "--binary-mode": {
        const v = value(++i, arg);
        if (!BINARY_MODES.has(v)) usage(`invalid --binary-mode "${v}" -- expected ref|base64`);
        args.binaryMode = v as BinaryMode;
        break;
      }
      case "--copy-assets":
        args.copyAssets = true;
        break;
      default:
        if (arg.startsWith("-") && arg !== "-") usage(`unknown option "${arg}"`);
        positionals.push(arg);
    }
  }
  if (positionals.length > 2) usage(`unexpected argument "${positionals[2]}"`);
  args.command = positionals[0];
  args.positional = positionals[1];
  return args;
}

/** Everything one build needs, after the template argument, manifest and flags are combined. */
export interface BuildConfig {
  templatePath: string;
  manifest?: LoadedManifest;
  vars: Record<string, unknown>;
  varsGiven: boolean;
  dryRun: boolean;
  debounceMs: number;
  watchIgnore: string[];
  options: RenderOptions & { outDir: string; cwd: string; cache: boolean };
}

async function resolveBuildConfig(args: ParsedArgs): Promise<BuildConfig> {
  const here = process.cwd();
  let manifest: LoadedManifest | undefined;
  let templatePath: string;
  if (args.positional !== undefined) {
    if (args.project !== undefined) usage("give either a template or --project, not both");
    templatePath = resolvePath(here, args.positional);
  } else {
    manifest = await findManifest(resolvePath(here, args.project ?? "."));
    if (!manifest) {
      usage(
        `no template given and no manifest in ${resolvePath(here, args.project ?? ".")} ` +
          '(fileable.config.json, or a "fileable" field in package.json)',
      );
    }
    templatePath = resolvePath(manifest.dir, manifest.manifest.template);
  }
  const m = manifest?.manifest;
  const fromManifest = (p: string | undefined) => (p !== undefined && manifest ? resolvePath(manifest.dir, p) : undefined);
  const fromArgs = (p: string | undefined) => (p !== undefined ? resolvePath(here, p) : undefined);

  const outDir = fromArgs(args.outDir) ?? fromManifest(m?.outDir) ?? dirname(templatePath);
  const cwd = fromArgs(args.cwd) ?? fromManifest(m?.cwd) ?? outDir;
  return {
    templatePath,
    manifest,
    vars: { ...(m?.vars ?? {}), ...args.vars },
    varsGiven: args.varsGiven || (m?.vars !== undefined && Object.keys(m.vars).length > 0),
    dryRun: args.dryRun,
    debounceMs: args.debounceMs ?? m?.watch?.debounceMs ?? 100,
    watchIgnore: m?.watch?.ignore ?? [],
    options: {
      outDir,
      cwd,
      allowExec: args.allowExec,
      strict: args.strict || m?.strict === true,
      cache: args.cache && m?.cache !== false,
      dryRun: args.dryRun,
      lockFile: fromArgs(args.lockFile) ?? fromManifest(m?.lockFile),
      encode: args.encode ?? m?.encode,
      ipfsGateway: m?.ipfsGateway,
    },
  };
}

/**
 * Imports the template and evaluates it to a tree. Every failure is a
 * FileableError with an E_TEMPLATE_* code (or the code a FileableError
 * thrown while evaluating already had, e.g. E_INVALID_TREE).
 */
async function loadTree(config: BuildConfig, emitter: Emitter, generation: number): Promise<unknown> {
  const { templatePath } = config;
  const rel = relativePath(process.cwd(), templatePath);
  const shown = rel && !rel.startsWith("..") ? rel : templatePath;
  try {
    const info = await stat(templatePath);
    if (!info.isFile()) throw new Error("not a file");
  } catch (cause) {
    if ((cause as { code?: string }).code === "ERR_ACCESS_DENIED") {
      throw new FileableError(`can't read template "${shown}"`, templatePath, cause, "E_ACCESS_DENIED");
    }
    throw new FileableError(`template "${shown}" not found`, templatePath, undefined, "E_MODULE_NOT_FOUND");
  }

  const url = pathToFileURL(templatePath).href + (generation > 0 ? `?fileable-watch=${generation}` : "");
  let mod: { default?: unknown };
  try {
    mod = (await import(url)) as { default?: unknown };
  } catch (cause) {
    if (cause instanceof FileableError) throw cause;
    throw new FileableError(`failed to import template "${shown}"`, templatePath, cause, "E_MODULE_LOAD");
  }
  if (mod.default === undefined) {
    throw new FileableError(
      `"${shown}" has no default export -- templates must \`export default <tree>\``,
      templatePath,
      undefined,
      "E_NOT_A_TEMPLATE",
    );
  }
  if (typeof mod.default === "function") {
    try {
      return await (mod.default as (vars: Record<string, unknown>) => unknown)(config.vars);
    } catch (cause) {
      if (cause instanceof FileableError) throw cause;
      throw new FileableError(`template function threw for "${shown}"`, templatePath, cause, "E_MODULE_LOAD");
    }
  }
  if (config.varsGiven) {
    emitter.warning({
      code: "E_VARS_IGNORED",
      message: `--var was provided but "${shown}"'s default export is not a function, so vars are ignored`,
    });
  }
  return mod.default;
}

function toPosix(path: string): string {
  return sep === "/" ? path : path.split(sep).join("/");
}

export interface BuildCycle {
  build?: number;
  trigger?: { reason: "initial" | "change"; paths: string[] };
  generation: number;
}

export interface BuildResult {
  exitCode: number;
  summary?: WriteSummary;
}

/** One build: start event, template load, render, file/warning events, done. Never throws. */
export async function buildOnce(command: Command, config: BuildConfig, emitter: Emitter, cycle: BuildCycle): Promise<BuildResult> {
  const started = performance.now();
  const { options } = config;
  emitter.emit({
    event: "start",
    command,
    ...(cycle.build !== undefined ? { build: cycle.build } : {}),
    ...(cycle.trigger ? { trigger: cycle.trigger } : {}),
    template: config.templatePath,
    ...(config.manifest ? { manifest: config.manifest.path } : {}),
    outDir: options.outDir,
    cwd: options.cwd,
    dryRun: config.dryRun,
    cache: options.cache,
    fileable: FILEABLE_VERSION,
    node: process.version,
  });

  let warnings = 0;
  const countingEmitter = (w: Parameters<Emitter["warning"]>[0]) => {
    warnings += 1;
    emitter.warning(w);
  };
  const scoped = new Emitter(emitter.json, emitter.io, emitter.redirectStdout);
  scoped.warning = countingEmitter;

  let phase = "load" as "load" | "build";
  try {
    const summary = await withStdoutToStderr(emitter.redirectStdout, emitter.io, async () => {
      // Missing grants under `node --permission` are reported before any work
      // starts, naming the flag to add (#25).
      assertPermitted("fs.read", config.templatePath, `reading the template ${config.templatePath}`);
      if (!config.dryRun) assertPermitted("fs.write", options.outDir, `writing to ${options.outDir}`);
      const tree = await loadTree(config, scoped, cycle.generation);
      phase = "build";
      return render(tree, { ...options, onWarning: countingEmitter });
    });
    const unchanged = summary.outputs.filter((o) => o.action === "unchanged").length;
    const skipped = summary.skipped.length - unchanged;
    for (const entry of summary.outputs) emitter.emit({ event: "file", ...entry, path: toPosix(entry.path) });
    for (const path of summary.removed) emitter.emit({ event: "file", path: toPosix(path), action: "removed" });
    for (const path of summary.written) emitter.say(`  write ${path}`);
    for (const path of summary.skipped) emitter.say(`  skip  ${path}`);
    for (const path of summary.removed) emitter.say(`  rm    ${path}`);
    const suffix = config.dryRun ? " (dry run)" : "";
    emitter.say(
      `fileable: ${summary.written.length} written, ${summary.skipped.length} skipped, ${summary.removed.length} removed${suffix}`,
    );
    emitter.emit({
      event: "done",
      command,
      ok: true,
      exitCode: EXIT_OK,
      durationMs: Math.round(performance.now() - started),
      ...(cycle.build !== undefined ? { build: cycle.build } : {}),
      dryRun: config.dryRun,
      counts: { written: summary.written.length, unchanged, skipped, removed: summary.removed.length, warnings },
      buildHash: summary.buildHash,
      output: outputShape(options.outDir, summary.outputs.map((o) => ({ ...o, path: toPosix(o.path) }))),
    });
    return { exitCode: EXIT_OK, summary };
  } catch (error) {
    const description = { ...describeError(error), fatal: command !== "watch" };
    emitter.error(description, phase === "build" ? "build failed" : undefined);
    emitter.emit({
      event: "done",
      command,
      ok: false,
      exitCode: description.exitCode,
      durationMs: Math.round(performance.now() - started),
      ...(cycle.build !== undefined ? { build: cycle.build } : {}),
      dryRun: config.dryRun,
      counts: { written: 0, unchanged: 0, skipped: 0, removed: 0, warnings },
    });
    return { exitCode: description.exitCode };
  }
}

async function runClean(args: ParsedArgs, emitter: Emitter): Promise<number> {
  const started = performance.now();
  const here = process.cwd();
  let dir: string;
  let lockPath: string;
  let manifest: LoadedManifest | undefined;
  if (args.outDir) dir = resolvePath(here, args.outDir);
  else if (args.positional) dir = resolvePath(here, args.positional);
  else {
    manifest = await findManifest(resolvePath(here, args.project ?? "."));
    const m = manifest?.manifest;
    dir = manifest
      ? m!.outDir !== undefined
        ? resolvePath(manifest.dir, m!.outDir)
        : dirname(resolvePath(manifest.dir, m!.template))
      : here;
    if (manifest && m!.lockFile !== undefined && !args.lockFile) {
      args.lockFile = resolvePath(manifest.dir, m!.lockFile);
    }
  }
  lockPath = args.lockFile ? resolvePath(here, args.lockFile) : resolvePath(dir, ".fileable-lock.json");

  emitter.emit({
    event: "start",
    command: "clean",
    ...(manifest ? { manifest: manifest.path } : {}),
    outDir: dir,
    dryRun: args.dryRun,
    fileable: FILEABLE_VERSION,
    node: process.version,
  });

  const lock = await readLockFile(lockPath);
  const done = (removed: number) =>
    emitter.emit({
      event: "done",
      command: "clean",
      ok: true,
      exitCode: EXIT_OK,
      durationMs: Math.round(performance.now() - started),
      dryRun: args.dryRun,
      counts: { written: 0, unchanged: 0, skipped: 0, removed, warnings: 0 },
    });
  if (!lock) {
    emitter.say(`fileable: no lock file at ${relativePath(here, lockPath)} -- nothing to clean`);
    done(0);
    return EXIT_OK;
  }

  // Lock keys are artifact ids, not always real filesystem paths: a
  // container-internal entry's id is "<containerPath>::<outputPath>" (SS8) --
  // only the container's own .zip/.wbn (no "::") is a real path to remove;
  // deleting that removes everything inside it. Loose artifacts' ids already
  // *are* their real relative path.
  const realPaths = Object.keys(lock.artifacts).filter((id) => !id.includes("::"));

  for (const relative of realPaths) {
    if (!args.dryRun) await rm(resolvePath(dir, relative), { recursive: true, force: true });
    emitter.say(`  rm ${relative}`);
    emitter.emit({ event: "file", path: relative, action: "removed" });
  }
  if (!args.dryRun) await rm(lockPath, { force: true });
  const lockRelative = toPosix(relativePath(dir, lockPath));
  emitter.say(`  rm ${relativePath(dir, lockPath)}`);
  emitter.emit({ event: "file", path: lockRelative, action: "removed" });

  const suffix = args.dryRun ? " (dry run)" : "";
  emitter.say(`fileable: ${realPaths.length + 1} removed${suffix}`);
  done(realPaths.length + 1);
  return EXIT_OK;
}

/**
 * `reflect()`'s `onAsk` is never called for binary content (it has only
 * one valid answer, "ref"), so this prompt only ever needs to phrase the
 * question for text files.
 */
async function askAboutFile(file: EjectFileInfo): Promise<"inline" | "ref"> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await rl.question(
      `fileable eject: ${file.relativePath} (text, ${file.size} bytes) -- inline or reference? [i/r] `,
    );
    return answer.trim().toLowerCase().startsWith("r") ? "ref" : "inline";
  } finally {
    rl.close();
  }
}

async function runEject(args: ParsedArgs, emitter: Emitter): Promise<number> {
  if (!args.positional) usage("eject needs a <path>");
  if (args.json && args.contentMode === "ask") usage('--content-mode ask is interactive and can\'t be used with --json');
  const started = performance.now();
  const rootPath = resolvePath(process.cwd(), args.positional);
  const outFile = args.out ? resolvePath(process.cwd(), args.out) : undefined;
  emitter.emit({ event: "start", command: "eject", template: rootPath, dryRun: args.dryRun, fileable: FILEABLE_VERSION, node: process.version });

  const source = await reflect(rootPath, {
    contentMode: args.contentMode,
    content: args.content,
    binaryMode: args.binaryMode,
    copyAssets: args.copyAssets,
    outFile,
    onAsk: args.contentMode === "ask" ? askAboutFile : undefined,
  });

  const counts = { written: 0, unchanged: 0, skipped: 0, removed: 0, warnings: 0 };
  let inlineSource: string | undefined;
  if (outFile && !args.dryRun) {
    await mkdir(dirname(outFile), { recursive: true });
    await writeFile(outFile, source, "utf8");
    counts.written = 1;
    emitter.say(`fileable: wrote ${relativePath(process.cwd(), outFile)}`);
    emitter.emit({ event: "file", path: outFile, action: "written", kind: "file", encode: "loose" });
  } else if (emitter.json) {
    inlineSource = source;
  } else {
    emitter.io.stdout(source);
  }
  emitter.emit({
    event: "done",
    command: "eject",
    ok: true,
    exitCode: EXIT_OK,
    durationMs: Math.round(performance.now() - started),
    dryRun: args.dryRun,
    counts,
    ...(inlineSource !== undefined ? { source: inlineSource } : {}),
  });
  return EXIT_OK;
}

async function runManifest(args: ParsedArgs, emitter: Emitter): Promise<number> {
  const dir = resolvePath(process.cwd(), args.positional ?? args.project ?? ".");
  const found = await findManifest(dir);
  if (!found) {
    throw new FileableError(
      `no manifest in ${dir} (fileable.config.json, or a "fileable" field in package.json)`,
      dir,
      undefined,
      "E_MANIFEST",
    );
  }
  if (emitter.json) {
    emitter.emit({ event: "manifest", path: found.path, source: found.source, manifest: found.manifest as unknown as Record<string, unknown> });
  } else {
    emitter.io.stdout(`${found.path}\n${JSON.stringify(found.manifest, null, 2)}\n`);
  }
  return EXIT_OK;
}

export interface MainOptions {
  /** Where output goes (default: process.stdout / process.stderr). */
  io?: Io;
  /** watch only: stops watching when aborted (in addition to SIGINT/SIGTERM). */
  signal?: AbortSignal;
}

export async function main(argv: string[], mainOptions: MainOptions = {}): Promise<number> {
  const io = mainOptions.io ?? defaultIo();
  const json = argv.includes("--json");
  const emitter = new Emitter(json, io, json && mainOptions.io === undefined);
  const exitCode = await dispatch(argv, emitter, mainOptions);
  // Shared with servable/hostable: `stopped` is always the last line.
  emitter.emit({ event: "stopped", exitCode });
  return exitCode;
}

async function dispatch(argv: string[], emitter: Emitter, mainOptions: MainOptions): Promise<number> {
  const { io, json } = emitter;
  let command: Command | undefined;

  try {
    const args = parseArgs(argv);
    if (args.help) {
      io.stdout(HELP);
      return EXIT_OK;
    }
    if (args.version) {
      if (json) emitter.emit({ event: "version", fileable: FILEABLE_VERSION, node: process.version, eventsSchemaVersion: EVENTS_SCHEMA_VERSION });
      else io.stdout(`${FILEABLE_VERSION}\n`);
      return EXIT_OK;
    }
    switch (args.command) {
      case "build":
      case "watch": {
        command = args.command;
        const config = await resolveBuildConfig(args);
        installLoader();
        if (args.command === "build") {
          return (await buildOnce("build", config, emitter, { generation: 0 })).exitCode;
        }
        return await runWatch(config, emitter, { signal: mainOptions.signal });
      }
      case "clean":
        command = "clean";
        return await runClean(args, emitter);
      case "eject":
        command = "eject";
        return await runEject(args, emitter);
      case "manifest":
        command = "manifest";
        return await runManifest(args, emitter);
      case undefined:
        if (!json) io.stderr(HELP);
        usage("no command given");
      default:
        usage(`unknown command "${args.command}"`);
    }
  } catch (error) {
    const description = describeError(error);
    emitter.error(description, command === "eject" ? "eject failed" : undefined);
    return description.exitCode;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
