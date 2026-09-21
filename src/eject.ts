/**
 * `eject` is `build`'s dual: instead of turning a JSX tree into a real
 * filesystem tree, it walks a real filesystem tree and turns it back into
 * JSX source text. Round-tripping `fileable build <eject output>` recreates
 * the same tree it was ejected from (every node is explicitly named, so
 * nameless inlining never kicks in on the way back).
 *
 * The one decision ejection has to make that build never does: for each
 * file, is its content *inlined* as source text, or *referenced* via
 * `src="..."` pointing back at the real file on disk? That's `contentMode`:
 *  - "infer" (default): sniff via content-util's `isUtf8Text` -- text
 *    inlines, binary references. Free, since the binary-safety work
 *    already built the detector.
 *  - "inline" / "ref": force one for every file. Forcing "inline" on
 *    binary content throws, UNLESS `binaryMode: "base64"` is also set (see
 *    below) -- there's no safe way to put raw bytes directly into source
 *    text, but base64-encoding them is exactly what that option is for.
 *  - "ask": defer to `onAsk` (SDK) or an interactive CLI prompt
 *    (bin/fileable.ts), for authors who'd rather decide per file than
 *    trust a heuristic. Binary content is never asked about -- its answer
 *    is already fully determined by `binaryMode` (see below), so there's
 *    nothing to decide.
 * `content` overrides (glob -> mode) are checked first, before the global
 * `contentMode`, for exceptions to the default without switching modes
 * globally.
 *
 * A SECOND, independent decision, only for binary content that would
 * otherwise need "ref": `binaryMode` ("ref", default, or "base64"). "ref"
 * is today's original behavior (a `src="..."` pointing back at the real
 * file). "base64" instead generates `base64="..."` (see `FileProps.base64`)
 * -- a fully self-contained round trip with no dependency on the original
 * file's continued existence at that path, at the cost of a much larger
 * generated source file for anything but small assets.
 *
 * Referenced files are **not** copied by default (`copyAssets: false`) --
 * `src` points at the real file in its original location, computed
 * relative to `outFile` (where the generated source is meant to live;
 * defaults to a sibling "<name>.tsx" next to the ejected path itself, so
 * the reference collapses to just "<name>/<relative path>", pointing back
 * into the very directory being described). Set `copyAssets: true` to copy
 * referenced files into an `assets/` directory next to `outFile` instead,
 * for a template that can survive being moved independently of its source
 * tree.
 *
 * Not captured: file mode/permission bits and the `useCollection` /
 * `linkTo` runtime machinery -- ejection reconstructs *structure and
 * content*, not the authoring-time relationships that produced them.
 */
import { copyFile, lstat, mkdir, readFile, readdir, readlink } from "node:fs/promises";
import { basename, dirname, join, relative, resolve as resolvePath, sep } from "node:path";
import { minimatch } from "minimatch";
import { Dir, File } from "./components.js";
import { isUtf8Text } from "./content-util.js";
import { isDescriptor, FileableError } from "./types.js";
import type { Descriptor } from "./types.js";

export type BinaryMode = "ref" | "base64";

export const BINARY_MODES: ReadonlySet<string> = new Set(["ref", "base64"]);

export type ContentMode = "infer" | "inline" | "ref" | "ask";

export const CONTENT_MODES: ReadonlySet<string> = new Set(["infer", "inline", "ref", "ask"]);

export interface ContentOverride {
  /** Glob matched against the file's path relative to the ejected root (posix-separated). */
  pattern: string;
  mode: "inline" | "ref";
}

export interface EjectFileInfo {
  /** Path relative to the ejected root, posix-separated. */
  relativePath: string;
  absolutePath: string;
  size: number;
  /** Whether the raw bytes round-trip as UTF-8 text (content-util.ts). */
  isText: boolean;
}

export interface EjectOptions {
  /** Default decision for every file not matched by `content`. Default: "infer". */
  contentMode?: ContentMode;
  /** Per-glob overrides, checked in order before `contentMode`; first match wins. */
  content?: ContentOverride[];
  /**
   * Called once per *text* file whose mode resolves to "ask" (binary
   * content has only one valid answer, "ref", so it's never asked about).
   * Required whenever that happens -- there's no silent default to fall
   * back to, matching this project's fail-loudly convention for every
   * other unspecified/ambiguous choice (reserved tags, invalid
   * `onConflict`/`as`/`join`, ...).
   */
  onAsk?: (file: EjectFileInfo) => Promise<"inline" | "ref">;
  /**
   * Where the generated source is meant to be saved; used only to compute
   * relative `src` paths, never written to by `reflect()` itself. Default:
   * "<basename(path)>.tsx" next to `path`.
   */
  outFile?: string;
  /** Copy referenced files into an `assets/` dir next to `outFile` instead of pointing at their original location. Default: false. */
  copyAssets?: boolean;
  /**
   * How binary content is represented when it would otherwise need
   * `ref` (either because `contentMode`/an override resolved to "ref" for
   * it under "infer"/"ask", or "inline" was forced on it explicitly).
   * Default "ref" (today's behavior, unchanged): generate `src="..."`
   * pointing back at the original file. "base64": generate
   * `base64="..."` instead -- a self-contained round trip
   * (`fileable build` on the ejected output reproduces the exact same
   * bytes) with no dependency on the original file's continued existence
   * at that path, at the cost of a much larger generated source file for
   * anything but small assets.
   */
  binaryMode?: BinaryMode;
}

function validateOptions(options: EjectOptions): void {
  if (options.contentMode !== undefined && !CONTENT_MODES.has(options.contentMode)) {
    throw new FileableError(
      `invalid contentMode "${options.contentMode}" -- expected "infer", "inline", "ref", or "ask"`,
      "<eject options>",
    );
  }
  for (const override of options.content ?? []) {
    if (override.mode !== "inline" && override.mode !== "ref") {
      throw new FileableError(
        `invalid content override mode "${String(override.mode)}" for pattern "${override.pattern}" -- expected "inline" or "ref"`,
        override.pattern,
      );
    }
  }
  if (options.binaryMode !== undefined && !BINARY_MODES.has(options.binaryMode)) {
    throw new FileableError(
      `invalid binaryMode "${options.binaryMode}" -- expected "ref" or "base64"`,
      "<eject options>",
    );
  }
}

/** Walks a real filesystem path and returns generated fileable TSX source describing it. */
export async function reflect(path: string, options: EjectOptions = {}): Promise<string> {
  validateOptions(options);

  const rootAbs = resolvePath(path);
  const outFile = options.outFile ? resolvePath(options.outFile) : join(dirname(rootAbs), `${basename(rootAbs)}.tsx`);
  const outDir = dirname(outFile);
  const assetsDir = options.copyAssets ? join(outDir, "assets") : undefined;
  if (assetsDir) await mkdir(assetsDir, { recursive: true });

  const rootStat = await lstat(rootAbs);
  let root: Descriptor;
  if (rootStat.isSymbolicLink()) {
    root = File({ name: basename(rootAbs), symlink: await readlink(rootAbs) });
  } else if (rootStat.isDirectory()) {
    root = await walkDir(rootAbs, "", options, outDir, assetsDir);
  } else {
    root = await describeFile(rootAbs, basename(rootAbs), basename(rootAbs), options, outDir, assetsDir);
  }

  return printModule(root);
}

async function walkDir(
  absDir: string,
  relDir: string,
  options: EjectOptions,
  outDir: string,
  assetsDir: string | undefined,
): Promise<Descriptor> {
  const entries = (await readdir(absDir, { withFileTypes: true }))
    .filter((entry) => entry.name !== ".fileable-lock.json")
    .sort((a, b) => a.name.localeCompare(b.name));

  const children: Descriptor[] = [];
  for (const entry of entries) {
    const absChild = join(absDir, entry.name);
    const relChild = relDir ? `${relDir}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) {
      children.push(File({ name: entry.name, symlink: await readlink(absChild) }));
    } else if (entry.isDirectory()) {
      children.push(await walkDir(absChild, relChild, options, outDir, assetsDir));
    } else {
      children.push(await describeFile(absChild, relChild, entry.name, options, outDir, assetsDir));
    }
  }
  return Dir({ name: basename(absDir), children });
}

async function describeFile(
  absPath: string,
  relPath: string,
  name: string,
  options: EjectOptions,
  outDir: string,
  assetsDir: string | undefined,
): Promise<Descriptor> {
  const buffer = await readFile(absPath);
  const info: EjectFileInfo = {
    relativePath: relPath,
    absolutePath: absPath,
    size: buffer.length,
    isText: isUtf8Text(buffer),
  };
  const mode = await resolveMode(info, options);

  if (mode === "inline") {
    if (!info.isText) {
      // Only reachable when binaryMode: "base64" is set (see resolveMode,
      // which routes binary content to "ref" unconditionally otherwise) --
      // an explicit contentMode: "inline" override on a binary file WITHOUT
      // binaryMode: "base64" still throws below; forcing "inline" without
      // opting into base64 has no other safe interpretation.
      if (options.binaryMode === "base64") {
        return File({ name, base64: buffer.toString("base64") });
      }
      throw new FileableError(
        `cannot inline binary content as source text: ${relPath} -- use contentMode "ref" (or a content override), ` +
          `or set { binaryMode: "base64" } to inline it as base64 instead`,
        relPath,
      );
    }
    return File({ name, children: [buffer.toString("utf8")] });
  }

  let src: string;
  if (assetsDir) {
    const dest = join(assetsDir, relPath);
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(absPath, dest);
    src = toRelativeSrc(outDir, dest);
  } else {
    src = toRelativeSrc(outDir, absPath);
  }
  return File({ name, src });
}

async function resolveMode(info: EjectFileInfo, options: EjectOptions): Promise<"inline" | "ref"> {
  for (const override of options.content ?? []) {
    if (minimatch(info.relativePath, override.pattern)) return override.mode;
  }
  const mode = options.contentMode ?? "infer";
  if (mode === "inline" || mode === "ref") return mode;
  // "infer" or "ask": binary content normally has exactly one valid
  // answer -- "ref" -- so there's nothing to infer or ask about. With
  // binaryMode: "base64" set, it routes to "inline" instead, where
  // describeFile() encodes it as base64 rather than throwing.
  if (!info.isText) return options.binaryMode === "base64" ? "inline" : "ref";
  if (mode === "infer") return "inline";
  if (!options.onAsk) {
    throw new FileableError(
      `contentMode "ask" requires an onAsk callback (the CLI supplies an interactive prompt automatically; the SDK does not)`,
      info.relativePath,
    );
  }
  return options.onAsk(info);
}

function toRelativeSrc(fromDir: string, toPath: string): string {
  const rel = relative(fromDir, toPath).split(sep).join("/");
  return rel.startsWith(".") ? rel : `./${rel}`;
}

function printModule(root: Descriptor): string {
  const body = printNode(root, 1);
  return `import { Dir, File } from "@johnhenry/fileable";\n\nexport default (\n${body}\n);\n`;
}

function printNode(node: Descriptor, depth: number): string {
  const tagName = node.tag === "dir" ? "Dir" : "File";
  const attrs = printAttrs(node.props);
  const kids = node.children ?? [];
  const pad = "  ".repeat(depth);

  if (kids.length === 0) {
    return `${pad}<${tagName}${attrs} />`;
  }
  if (kids.length === 1 && typeof kids[0] === "string") {
    return `${pad}<${tagName}${attrs}>{${toTemplateLiteral(kids[0])}}</${tagName}>`;
  }
  const inner = kids
    .filter(isDescriptor)
    .map((child) => printNode(child, depth + 1))
    .join("\n");
  return `${pad}<${tagName}${attrs}>\n${inner}\n${pad}</${tagName}>`;
}

function printAttrs(props: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(props)) {
    if (typeof value !== "string") continue; // name/src/base64/symlink/mode are the only string props reflect() ever sets
    parts.push(` ${printAttr(key, value)}`);
  }
  return parts.join("");
}

function printAttr(name: string, value: string): string {
  if (/^[^"{}\n\\]*$/.test(value)) return `${name}="${value}"`;
  return `${name}={${JSON.stringify(value)}}`;
}

function toTemplateLiteral(text: string): string {
  const escaped = text.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
  return `\`${escaped}\``;
}
