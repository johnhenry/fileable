/**
 * Module hooks the CLI installs before importing a template (#25), using
 * Node's in-thread `module.registerHooks()` (no worker thread, so it also
 * works under `node --permission` without --allow-worker):
 *
 * 1. `.tsx` / `.jsx` modules. Node 26 strips TypeScript types on its own,
 *    so `.ts` / `.mts` templates load with no compile step, but it does not
 *    parse JSX (and `module.stripTypeScriptTypes()` has no transform mode),
 *    so JSX needs a compiler. fileable doesn't ship one (no new runtime
 *    dependency); it uses whichever of these the *template's project* has
 *    installed, checked in this order:
 *      - `typescript` 5.x/6.x (`transpileModule()`, pure JS, so it also works
 *        under the permission model without --allow-child-process)
 *      - `esbuild` (`transformSync()`; it runs esbuild's native binary from
 *        a worker thread, so under the permission model it needs both
 *        --allow-child-process and --allow-worker)
 *    With neither, loading a `.tsx`/`.jsx` module throws E_JSX_COMPILER
 *    naming the options. TypeScript 7 (the native compiler) has no
 *    in-process transpile API, so it doesn't count.
 *
 * 2. `@johnhenry/fileable` imports always resolve to the fileable that is
 *    running the build, even when the project has no copy (or a different
 *    one) installed. `warn()`, `useCollection()` and the JSX runtime keep
 *    module-level state; two copies would mean the CLI never sees it.
 *
 * 3. Watch mode: after the first build, project-local modules (file: URLs
 *    outside node_modules) get a `?fileable-watch=<n>` query, so each
 *    rebuild imports the template and its partials fresh instead of from
 *    Node's module cache. Old generations stay in memory until the process
 *    exits; that's the cost of re-importing ESM in one process.
 */
import { createRequire, registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { FileableError } from "../src/types.js";

const JSX_EXTENSION = /\.(tsx|jsx)$/;
const SELF = "@johnhenry/fileable";
const packageRoot = new URL("../../", import.meta.url).href;
/** This fileable's own entry points (dist/bin -> dist/src), mirroring package.json "exports". */
const SELF_EXPORTS: Record<string, string> = {
  [SELF]: new URL("../src/index.js", import.meta.url).href,
  [`${SELF}/jsx-runtime`]: new URL("../src/jsx-runtime.js", import.meta.url).href,
  [`${SELF}/jsx-dev-runtime`]: new URL("../src/jsx-dev-runtime.js", import.meta.url).href,
  [`${SELF}/browser`]: new URL("../src/browser/index.js", import.meta.url).href,
};

let installed = false;
let generation = 0;

type Transform = (source: string, filename: string) => string;
const transformCache = new Map<string, Transform | null>();

/** Bumps the watch generation; modules imported after this are fresh copies. */
export function nextGeneration(): number {
  generation += 1;
  return generation;
}

export function currentGeneration(): number {
  return generation;
}

function findTransform(filename: string): Transform | null {
  const require = createRequire(filename);
  const key = `${safeResolve(require, "typescript")}|${safeResolve(require, "esbuild")}`;
  if (transformCache.has(key)) return transformCache.get(key)!;

  let transform: Transform | null = null;
  try {
    const ts = require("typescript") as {
      transpileModule?: (input: string, options: unknown) => { outputText: string };
      JsxEmit?: Record<string, number>;
      ModuleKind?: Record<string, number>;
      ScriptTarget?: Record<string, number>;
    };
    if (typeof ts.transpileModule === "function") {
      transform = (source, file) =>
        ts.transpileModule!(source, {
          fileName: file,
          compilerOptions: {
            jsx: ts.JsxEmit!.ReactJSX,
            jsxImportSource: SELF,
            module: ts.ModuleKind!.ESNext,
            target: ts.ScriptTarget!.ES2022,
            inlineSourceMap: true,
            inlineSources: true,
          },
        }).outputText;
    }
  } catch {
    // not installed
  }
  if (!transform) {
    try {
      const esbuild = require("esbuild") as {
        transformSync: (input: string, options: unknown) => { code: string };
      };
      transform = (source, file) =>
        esbuild.transformSync(source, {
          loader: file.endsWith(".jsx") ? "jsx" : "tsx",
          jsx: "automatic",
          jsxImportSource: SELF,
          format: "esm",
          target: "es2022",
          sourcemap: "inline",
          sourcefile: file,
        }).code;
    } catch {
      // not installed
    }
  }
  transformCache.set(key, transform);
  return transform;
}

function safeResolve(require: NodeJS.Require, id: string): string {
  try {
    return require.resolve(id);
  } catch {
    return "";
  }
}

function isProjectModule(url: string): boolean {
  return url.startsWith("file:") && !url.includes("/node_modules/") && !url.startsWith(packageRoot);
}

export function installLoader(): void {
  if (installed) return;
  installed = true;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const self = SELF_EXPORTS[specifier];
      if (self) return { url: self, format: "module", shortCircuit: true };
      const result = nextResolve(specifier, context);
      if (generation > 0 && isProjectModule(result.url) && !result.url.includes("?")) {
        return { ...result, url: `${result.url}?fileable-watch=${generation}` };
      }
      return result;
    },
    load(url, context, nextLoad) {
      const pathname = url.startsWith("file:") ? new URL(url).pathname : "";
      if (!JSX_EXTENSION.test(pathname)) return nextLoad(url, context);
      const filename = fileURLToPath(url.split("?")[0]);
      const transform = findTransform(filename);
      if (!transform) {
        throw new FileableError(
          `can't load ${filename}: Node doesn't parse JSX, and the project has no JSX compiler fileable can use. ` +
            "Install one in the project (npm i -D esbuild, or typescript@5), compile the template to .js first, " +
            "or write it as .ts using h()/dir()/file() instead of JSX",
          filename,
          undefined,
          "E_JSX_COMPILER",
        );
      }
      const source = readFileSync(filename, "utf8");
      let code: string;
      try {
        code = transform(source, filename);
      } catch (cause) {
        const denied = (cause as { code?: string }).code === "ERR_ACCESS_DENIED";
        const permission = (cause as { permission?: string }).permission;
        const flag = permission === "WorkerThreads" ? "--allow-worker" : "--allow-child-process";
        const error = new FileableError(
          denied
            ? `can't compile ${filename}: the JSX compiler (esbuild) needs ${flag} under Node's permission model ` +
                "(esbuild needs both --allow-child-process and --allow-worker), or install typescript@5 in the project, " +
                "which compiles in-process with no extra grants"
            : `can't compile ${filename}`,
          filename,
          cause,
          denied ? "E_ACCESS_DENIED" : "E_MODULE_LOAD",
        );
        if (denied && permission) error.permission = permission;
        throw error;
      }
      return { format: "module", source: code, shortCircuit: true };
    },
  });
}
