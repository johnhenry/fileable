/**
 * Project manifest (#25): `fileable.config.json`, or a `"fileable"` field in
 * package.json, in a project directory. Lets an app (or a person) run
 * `fileable build` / `fileable watch` in a project with no other arguments.
 *
 * Only the project directory itself is checked (no walking up), so what a
 * build uses is predictable from the directory an app points at. Having
 * both files define a manifest is an error rather than a precedence rule.
 *
 * `allowExec` is deliberately not a manifest key: opening a project must
 * never be enough to let it run shell commands. Exec stays a flag the
 * person (or app) running fileable passes explicitly.
 */
import { readFile } from "node:fs/promises";
import { join, resolve as resolvePath } from "node:path";
import { FileableError } from "../src/types.js";
import type { RenderTarget } from "../src/types.js";
import { validateDecodeLimits } from "../src/archive-limits.js";
import type { DecodeLimits } from "../src/archive-limits.js";

export interface Manifest {
  /** Template module, relative to the project directory. Required. */
  template: string;
  /** Output directory, relative to the project directory. Default: the template's directory. */
  outDir?: string;
  /** Base directory for relative src/from paths. Default: outDir. */
  cwd?: string;
  /** Values passed to a template function, like --var. */
  vars?: Record<string, unknown>;
  /** Default encode for root <Dir>s that don't set their own. */
  encode?: RenderTarget;
  strict?: boolean;
  cache?: boolean;
  lockFile?: string;
  ipfsGateway?: string;
  watch?: { debounceMs?: number; ignore?: string[] };
  /** Size limits for <Dir src decode> archives (#32); flags override per key. */
  decodeLimits?: DecodeLimits;
}

export interface LoadedManifest {
  /** Absolute path of the file the manifest came from. */
  path: string;
  source: "fileable.config.json" | "package.json";
  /** Absolute project directory (where the manifest lives). */
  dir: string;
  manifest: Manifest;
}

const KEYS = new Set(["$schema", "template", "outDir", "cwd", "vars", "encode", "strict", "cache", "lockFile", "ipfsGateway", "watch", "decodeLimits"]);
const ENCODES = new Set(["loose", "zip", "wbn"]);

function fail(message: string, path: string): never {
  throw new FileableError(message, path, undefined, "E_MANIFEST");
}

async function readJson(path: string): Promise<unknown | undefined> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new FileableError(`can't read ${path}`, path, error, "E_MANIFEST");
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    fail(`${path} is not valid JSON: ${(error as Error).message}`, path);
  }
}

export function validateManifest(value: unknown, path: string): Manifest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail("manifest must be a JSON object", path);
  const m = value as Record<string, unknown>;
  for (const key of Object.keys(m)) {
    if (!KEYS.has(key)) {
      const hint = key === "allowExec" ? " -- exec is never enabled by a manifest; pass --allow-exec" : "";
      fail(`unknown manifest key "${key}"${hint}`, path);
    }
  }
  if (typeof m.template !== "string" || m.template === "") fail('manifest needs "template": a path to the template module', path);
  for (const key of ["outDir", "cwd", "lockFile", "ipfsGateway"]) {
    if (m[key] !== undefined && (typeof m[key] !== "string" || m[key] === "")) fail(`manifest "${key}" must be a non-empty string`, path);
  }
  for (const key of ["strict", "cache"]) {
    if (m[key] !== undefined && typeof m[key] !== "boolean") fail(`manifest "${key}" must be true or false`, path);
  }
  if (m.vars !== undefined && (typeof m.vars !== "object" || m.vars === null || Array.isArray(m.vars))) {
    fail('manifest "vars" must be an object', path);
  }
  if (m.encode !== undefined && !ENCODES.has(m.encode as string)) {
    fail(`invalid manifest encode=${JSON.stringify(m.encode)} -- expected "loose", "zip", or "wbn"`, path);
  }
  if (m.watch !== undefined) {
    const w = m.watch as Record<string, unknown>;
    if (typeof w !== "object" || w === null || Array.isArray(w)) fail('manifest "watch" must be an object', path);
    for (const key of Object.keys(w)) {
      if (key !== "debounceMs" && key !== "ignore") fail(`unknown manifest key "watch.${key}"`, path);
    }
    if (w.debounceMs !== undefined && (typeof w.debounceMs !== "number" || !(w.debounceMs >= 0))) {
      fail('manifest "watch.debounceMs" must be a number >= 0', path);
    }
    if (w.ignore !== undefined && (!Array.isArray(w.ignore) || w.ignore.some((p) => typeof p !== "string"))) {
      fail('manifest "watch.ignore" must be an array of glob strings', path);
    }
  }
  validateDecodeLimits(m.decodeLimits, 'manifest "decodeLimits"', path, "E_MANIFEST");
  const { $schema: _schema, ...rest } = m;
  return rest as unknown as Manifest;
}

/** Finds and validates the manifest in `dir`, or returns undefined when there is none. */
export async function findManifest(dir: string): Promise<LoadedManifest | undefined> {
  const projectDir = resolvePath(dir);
  const configPath = join(projectDir, "fileable.config.json");
  const pkgPath = join(projectDir, "package.json");
  const config = await readJson(configPath);
  const pkg = (await readJson(pkgPath)) as Record<string, unknown> | undefined;
  const pkgField = pkg && typeof pkg === "object" ? pkg.fileable : undefined;
  if (config !== undefined && pkgField !== undefined) {
    fail('both fileable.config.json and package.json "fileable" define a manifest -- keep one', projectDir);
  }
  if (config !== undefined) {
    return { path: configPath, source: "fileable.config.json", dir: projectDir, manifest: validateManifest(config, configPath) };
  }
  if (pkgField !== undefined) {
    return { path: pkgPath, source: "package.json", dir: projectDir, manifest: validateManifest(pkgField, `${pkgPath} "fileable"`) };
  }
  return undefined;
}
