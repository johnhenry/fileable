#!/usr/bin/env node
/**
 * Minimal build CLI: `fileable build <template>` imports a template module's
 * default export (a JSX tree) and renders it, so templates don't each need
 * their own `await render(tree, {...})` boilerplate at the bottom.
 *
 * `outDir`/`cwd` default to the template file's own directory (matching
 * what every hand-written example did before this existed) rather than the
 * invoking shell's cwd, since that's what makes a template's own relative
 * `src`/`from` paths resolve the way its author expects regardless of
 * where `fileable build` is invoked from.
 */
import { dirname, resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";
import { render } from "../src/render.js";
import type { RenderOptions } from "../src/types.js";

function printHelp(): void {
  console.log(`Usage: fileable build <template> [options]

Renders a template module's default export (a fileable JSX tree).

Options:
  -o, --out-dir <dir>   Directory artifacts are written into
                         (default: the template file's own directory)
  -c, --cwd <dir>        Base directory for resolving relative src/from paths
                         (default: same as --out-dir)
      --allow-exec       Allow the \`cmd\` attribute to execute shell commands
      --strict           Promote symlink-fallback warnings to hard errors
      --no-cache         Force a full rebuild, ignoring .fileable-lock.json
      --lock-file <path> Path to the incremental-build lock file
  -h, --help             Show this help
`);
}

interface ParsedArgs {
  command?: string;
  template?: string;
  outDir?: string;
  cwd?: string;
  allowExec: boolean;
  strict: boolean;
  cache: boolean;
  lockFile?: string;
  help: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = { allowExec: false, strict: false, cache: true, help: false };
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
      case "--allow-exec":
        args.allowExec = true;
        break;
      case "--strict":
        args.strict = true;
        break;
      case "--no-cache":
        args.cache = false;
        break;
      case "--lock-file":
        args.lockFile = argv[++i];
        break;
      default:
        positionals.push(arg);
    }
  }
  args.command = positionals[0];
  args.template = positionals[1];
  return args;
}

export async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);

  if (args.help) {
    printHelp();
    return 0;
  }
  if (args.command !== "build" || !args.template) {
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

  const outDir = args.outDir ? resolvePath(process.cwd(), args.outDir) : templateDir;
  const options: RenderOptions = {
    outDir,
    cwd: args.cwd ? resolvePath(process.cwd(), args.cwd) : outDir,
    allowExec: args.allowExec,
    strict: args.strict,
    cache: args.cache,
    lockFile: args.lockFile ? resolvePath(process.cwd(), args.lockFile) : undefined,
  };

  try {
    const summary = await render(mod.default, options);
    for (const path of summary.written) console.log(`  write ${path}`);
    for (const path of summary.skipped) console.log(`  skip  ${path}`);
    for (const path of summary.removed) console.log(`  rm    ${path}`);
    console.log(
      `fileable: ${summary.written.length} written, ${summary.skipped.length} skipped, ${summary.removed.length} removed`,
    );
    return 0;
  } catch (error) {
    console.error("fileable: build failed");
    console.error(error);
    return 1;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
