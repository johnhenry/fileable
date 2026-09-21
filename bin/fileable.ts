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
 */
import { dirname, relative as relativePath, resolve as resolvePath } from "node:path";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { render } from "../src/render.js";
import { readLockFile } from "../src/lock.js";
import { BINARY_MODES, CONTENT_MODES, reflect } from "../src/eject.js";
import type { BinaryMode, ContentMode, ContentOverride, EjectFileInfo } from "../src/eject.js";
import type { RenderOptions } from "../src/types.js";
import { parseVarFlag } from "./vars.js";

function printHelp(): void {
  console.log(`Usage: fileable build <template> [options]
       fileable clean [dir] [options]
       fileable eject <path> [options]

build renders a template module's default export -- a fileable JSX tree,
or a function (vars) => <Dir>... that receives --var-supplied values.

clean removes exactly what a previous build wrote (from
.fileable-lock.json) plus the lock file itself. [dir] defaults to "." and
must be the *same* directory build's --out-dir was (or its default, the
template's own directory) -- not a subfolder your tree's own <Dir name>
happens to create inside it, since that's just an artifact's output path,
recorded in the lock file relative to [dir] itself.

eject walks a real filesystem path and prints the fileable TSX source that
would build it -- build's dual, in the opposite direction. Prints to
stdout by default; pass --out to write it to a file instead. Referenced
(non-inlined) files point back at their original location unless
--copy-assets is given.

Options:
  -o, --out-dir <dir>    Directory artifacts are written into
                          (default for build: the template file's own
                          directory; default for clean: [dir] or ".")
  -c, --cwd <dir>         Base directory for resolving relative src/from paths
                          (build only; default: same as --out-dir)
      --var <key[:type]=value>
                          Pass a value to a template function (repeatable,
                          build only). type is one of string (default),
                          number, boolean, json. \`--var draft\` / \`--var
                          draft:boolean\` with no "=value" means true. E.g.:
                            --var title="Hello World"
                            --var count:number=3
                            --var draft:boolean=false
                            --var tags:json='["a","b"]'
      --allow-exec        Allow the \`cmd\` attribute to execute shell commands
      --strict            Promote symlink-fallback warnings to hard errors
      --no-cache          Force a full rebuild, ignoring .fileable-lock.json
      --lock-file <path>  Path to the incremental-build lock file
      --dry-run           Report what would happen without touching disk
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
  -h, --help              Show this help
`);
}

interface ParsedArgs {
  command?: string;
  template?: string;
  outDir?: string;
  cwd?: string;
  vars: Record<string, unknown>;
  allowExec: boolean;
  strict: boolean;
  cache: boolean;
  dryRun: boolean;
  lockFile?: string;
  help: boolean;
  out?: string;
  contentMode?: ContentMode;
  content: ContentOverride[];
  binaryMode?: BinaryMode;
  copyAssets: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    vars: {},
    allowExec: false,
    strict: false,
    cache: true,
    dryRun: false,
    help: false,
    content: [],
    copyAssets: false,
  };
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "-h":
      case "--help":
        args.help = true;
        break;
      case "-o":
      case "--out-dir":
        args.outDir = argv[++i];
        break;
      case "-c":
      case "--cwd":
        args.cwd = argv[++i];
        break;
      case "--var": {
        const [key, value] = parseVarFlag(argv[++i] ?? "");
        args.vars[key] = value;
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
      case "--lock-file":
        args.lockFile = argv[++i];
        break;
      case "--out":
        args.out = argv[++i];
        break;
      case "--content-mode": {
        const value = argv[++i];
        if (!CONTENT_MODES.has(value)) {
          throw new Error(`invalid --content-mode "${value}" -- expected infer|inline|ref|ask`);
        }
        args.contentMode = value as ContentMode;
        break;
      }
      case "--content": {
        const raw = argv[++i] ?? "";
        const eqIndex = raw.lastIndexOf("=");
        const mode = eqIndex === -1 ? "" : raw.slice(eqIndex + 1);
        if (eqIndex === -1 || (mode !== "inline" && mode !== "ref")) {
          throw new Error(`invalid --content "${raw}" -- expected <glob>=inline|ref`);
        }
        args.content.push({ pattern: raw.slice(0, eqIndex), mode });
        break;
      }
      case "--binary-mode": {
        const value = argv[++i];
        if (!BINARY_MODES.has(value)) {
          throw new Error(`invalid --binary-mode "${value}" -- expected ref|base64`);
        }
        args.binaryMode = value as BinaryMode;
        break;
      }
      case "--copy-assets":
        args.copyAssets = true;
        break;
      default:
        positionals.push(arg);
    }
  }
  args.command = positionals[0];
  args.template = positionals[1];
  return args;
}

async function runBuild(args: ParsedArgs): Promise<number> {
  if (!args.template) {
    printHelp();
    return 1;
  }
  const templatePath = resolvePath(process.cwd(), args.template);
  const templateDir = dirname(templatePath);

  let mod: { default?: unknown };
  try {
    mod = (await import(pathToFileURL(templatePath).href)) as { default?: unknown };
  } catch (error) {
    console.error(`fileable: failed to import template "${args.template}"`);
    console.error(error);
    return 1;
  }
  if (mod.default === undefined) {
    console.error(`fileable: "${args.template}" has no default export -- templates must \`export default <tree>\``);
    return 1;
  }

  let tree: unknown = mod.default;
  if (typeof mod.default === "function") {
    try {
      tree = await (mod.default as (vars: Record<string, unknown>) => unknown)(args.vars);
    } catch (error) {
      console.error(`fileable: template function threw for "${args.template}"`);
      console.error(error);
      return 1;
    }
  } else if (Object.keys(args.vars).length > 0) {
    console.error(
      `fileable: warning: --var was provided but "${args.template}"'s default export is not a function, so vars are ignored`,
    );
  }

  const outDir = args.outDir ? resolvePath(process.cwd(), args.outDir) : templateDir;
  const options: RenderOptions = {
    outDir,
    cwd: args.cwd ? resolvePath(process.cwd(), args.cwd) : outDir,
    allowExec: args.allowExec,
    strict: args.strict,
    cache: args.cache,
    dryRun: args.dryRun,
    lockFile: args.lockFile ? resolvePath(process.cwd(), args.lockFile) : undefined,
  };

  try {
    const summary = await render(tree, options);
    for (const path of summary.written) console.log(`  write ${path}`);
    for (const path of summary.skipped) console.log(`  skip  ${path}`);
    for (const path of summary.removed) console.log(`  rm    ${path}`);
    const suffix = args.dryRun ? " (dry run)" : "";
    console.log(
      `fileable: ${summary.written.length} written, ${summary.skipped.length} skipped, ${summary.removed.length} removed${suffix}`,
    );
    return 0;
  } catch (error) {
    console.error("fileable: build failed");
    console.error(error);
    return 1;
  }
}

async function runClean(args: ParsedArgs): Promise<number> {
  const dir = args.outDir
    ? resolvePath(process.cwd(), args.outDir)
    : resolvePath(process.cwd(), args.template ?? ".");
  const lockPath = args.lockFile ? resolvePath(process.cwd(), args.lockFile) : resolvePath(dir, ".fileable-lock.json");

  const lock = await readLockFile(lockPath);
  if (!lock) {
    console.log(`fileable: no lock file at ${relativePath(process.cwd(), lockPath)} -- nothing to clean`);
    return 0;
  }

  // Lock keys are artifact ids, not always real filesystem paths: a
  // container-internal entry's id is "<containerPath>::<outputPath>" (SS8) --
  // only the container's own .zip/.wbn (no "::") is a real path to remove;
  // deleting that removes everything inside it. Loose artifacts' ids already
  // *are* their real relative path.
  const realPaths = Object.keys(lock.artifacts).filter((id) => !id.includes("::"));

  for (const relative of realPaths) {
    if (!args.dryRun) await rm(resolvePath(dir, relative), { recursive: true, force: true });
    console.log(`  rm ${relative}`);
  }
  if (!args.dryRun) await rm(lockPath, { force: true });
  console.log(`  rm ${relativePath(dir, lockPath)}`);

  const suffix = args.dryRun ? " (dry run)" : "";
  console.log(`fileable: ${realPaths.length + 1} removed${suffix}`);
  return 0;
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

async function runEject(args: ParsedArgs): Promise<number> {
  if (!args.template) {
    printHelp();
    return 1;
  }
  const rootPath = resolvePath(process.cwd(), args.template);
  const outFile = args.out ? resolvePath(process.cwd(), args.out) : undefined;

  let source: string;
  try {
    source = await reflect(rootPath, {
      contentMode: args.contentMode,
      content: args.content,
      binaryMode: args.binaryMode,
      copyAssets: args.copyAssets,
      outFile,
      onAsk: args.contentMode === "ask" ? askAboutFile : undefined,
    });
  } catch (error) {
    console.error("fileable: eject failed");
    console.error(error);
    return 1;
  }

  if (outFile && !args.dryRun) {
    await mkdir(dirname(outFile), { recursive: true });
    await writeFile(outFile, source, "utf8");
    console.log(`fileable: wrote ${relativePath(process.cwd(), outFile)}`);
  } else {
    process.stdout.write(source);
  }
  return 0;
}

export async function main(argv: string[]): Promise<number> {
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    console.error(`fileable: ${(error as Error).message}`);
    return 1;
  }

  if (args.help) {
    printHelp();
    return 0;
  }
  if (args.command === "build") return runBuild(args);
  if (args.command === "clean") return runClean(args);
  if (args.command === "eject") return runEject(args);

  printHelp();
  return 1;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
