/**
 * Stage 2: Resolve (PRD SS4.2).
 *
 * Walks the full tree and resolves everything that needs async work:
 *  - `<dir from="glob">` expansion into synthesized `<file src=match>` children
 *  - `src` (read a local file, fetch a URL, import a compiled JS/JSX module's
 *    default export as further descriptor children, or await an
 *    already-in-flight Promise<string>)
 *  - `cmd` (shell out, gated by `allowExec` -- PRD SS7.1)
 *  - any other Promise-valued prop, generically
 *
 * Errors (thrown synchronously or via a rejected promise) are wrapped with
 * the offending node's tree path before propagating (PRD SS6.2).
 */
import { readFile } from "node:fs/promises";
import { basename, extname, isAbsolute, relative as relativePath, resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";
import { glob } from "glob";
import { cloneDescriptorTree, isDescriptor, isLinkRef, isThenable, FileableError } from "./types.js";
import type { Descriptor, DescriptorChild, RenderOptions } from "./types.js";
import { bufferToContent, combineContent } from "./content-util.js";
import { execCommand } from "./exec.js";
import { splitGlobBase, toPosixPattern } from "./glob-util.js";

const CODE_EXTENSIONS = new Set([".jsx", ".tsx", ".js", ".mjs", ".ts"]);

async function loadSrc(
  src: string,
  baseDir: string,
  path: string,
): Promise<{ content?: string | Buffer; children?: Descriptor[] }> {
  if (/^https?:\/\//.test(src)) {
    const res = await fetch(src);
    if (!res.ok) {
      throw new FileableError(`src fetch failed: ${src} (${res.status})`, path);
    }
    // Binary-safe: decide text vs. binary by round-trip rather than assuming
    // text (see content-util.ts) -- a fetched image/font/etc. must come back
    // byte-exact, not UTF-8-decoded.
    return { content: bufferToContent(Buffer.from(await res.arrayBuffer())) };
  }
  const absolute = isAbsolute(src) ? src : resolvePath(baseDir, src);
  if (CODE_EXTENSIONS.has(extname(absolute))) {
    let mod: { default?: unknown };
    try {
      mod = (await import(pathToFileURL(absolute).href)) as { default?: unknown };
    } catch (cause) {
      throw new FileableError(
        `failed to import src module "${src}" -- .jsx/.tsx partials must already be ` +
          "compiled to JS (or loadable via a registered Node loader) before render() runs",
        path,
        cause,
      );
    }
    const { build } = await import("./build.js");
    // Node's module cache returns the same `mod.default` object on every
    // import of this path -- clone it so each `<file src>` occurrence gets
    // its own independent subtree, not a shared instance (SS5.4).
    return { children: build(cloneDescriptorTree(mod.default)) };
  }
  try {
    // No encoding forced -- read raw bytes, then let bufferToContent decide
    // text vs. binary. Forcing "utf8" here used to silently corrupt any
    // non-text src (confirmed with a real PNG: every non-UTF-8 byte came
    // back as a replacement character).
    return { content: bufferToContent(await readFile(absolute)) };
  } catch (cause) {
    throw new FileableError(`failed to read src file "${src}"`, path, cause);
  }
}

async function resolveFromGlob(
  pattern: string | Promise<string[]> | string[],
  baseDir: string,
  path: string,
): Promise<string[]> {
  if (Array.isArray(pattern)) return pattern;
  if (isThenable(pattern)) {
    try {
      return await pattern;
    } catch (cause) {
      throw new FileableError("`from` promise rejected", path, cause);
    }
  }
  try {
    return await glob(toPosixPattern(pattern), { cwd: baseDir, absolute: true, nodir: true });
  } catch (cause) {
    throw new FileableError(`\`from\` glob expansion failed for "${pattern}"`, path, cause);
  }
}

export async function resolve(
  roots: Descriptor[],
  options: RenderOptions = {},
): Promise<Descriptor[]> {
  const baseDir = options.cwd ?? options.outDir ?? process.cwd();

  async function resolveNode(node: Descriptor, path: string): Promise<void> {
    if (node.tag === "dir" && node.props.from !== undefined) {
      const fromValue = node.props.from as string | Promise<string[]> | string[];
      const matches = await resolveFromGlob(fromValue, baseDir, path);
      // A pattern's fixed prefix (e.g. "assets" in "assets/**/*") is stripped
      // from each match's path-relative-to-baseDir, so nested matches keep
      // their subdirectory structure ("img/logo.png") instead of flattening
      // to a bare basename -- which, beyond losing structure, could silently
      // collide (two different "index.html"s in different source dirs
      // landing on the exact same output path with no warning).
      const patternBase = typeof fromValue === "string" ? splitGlobBase(toPosixPattern(fromValue)).base : "";
      const synthesized: Descriptor[] = matches.map((match) => {
        const relativeToBaseDir = toPosixPattern(relativePath(baseDir, match));
        const name =
          patternBase && relativeToBaseDir.startsWith(`${patternBase}/`)
            ? relativeToBaseDir.slice(patternBase.length + 1)
            : basename(match);
        return {
          tag: "file",
          props: { name, src: match },
          children: [],
          __id: `${node.__id}:${match}`,
        };
      });
      node.children = [...synthesized, ...node.children];
    }

    if (node.tag === "file") {
      const props = node.props as { __resolvedContent?: string | Buffer };
      const src = node.props.src as string | Promise<string> | undefined;
      if (src !== undefined) {
        if (isThenable(src)) {
          // An author-supplied Promise is documented as resolving to a
          // string (an "already resolved async value", PRD SS2.2) -- unlike
          // the file-read/URL-fetch paths, there's no raw bytes to sniff.
          try {
            props.__resolvedContent = combineContent(props.__resolvedContent, await src);
          } catch (cause) {
            throw new FileableError("`src` promise rejected", path, cause);
          }
        } else {
          const loaded = await loadSrc(src, baseDir, path);
          if (loaded.content !== undefined) {
            props.__resolvedContent = combineContent(props.__resolvedContent, loaded.content);
          }
          if (loaded.children !== undefined) {
            node.children = [...loaded.children, ...node.children];
          }
        }
      }

      const cmd = node.props.cmd as string | undefined;
      if (cmd !== undefined) {
        if (!options.allowExec) {
          throw new FileableError(
            `\`cmd\` attribute requires the renderer to be configured with allowExec: true (cmd="${cmd}")`,
            path,
          );
        }
        const stdout = await execCommand(cmd, baseDir).catch((cause: unknown) => {
          throw new FileableError(`cmd execution failed: ${cmd}`, path, cause);
        });
        props.__resolvedContent = combineContent(props.__resolvedContent, bufferToContent(stdout));
      }
    }

    // Generic fallback: any other promise-valued prop (future-proofing per SS4.1).
    for (const [key, value] of Object.entries(node.props)) {
      if (key === "src" || key === "from") continue;
      if (isThenable(value)) {
        try {
          node.props[key] = await value;
        } catch (cause) {
          throw new FileableError(`prop "${key}" promise rejected`, path, cause);
        }
      }
    }

    for (const child of node.children) {
      await resolveChild(child, `${path} > ${String(node.tag)}[${String(node.props.name ?? "")}]`);
    }
  }

  async function resolveChild(child: DescriptorChild, path: string): Promise<void> {
    if (isDescriptor(child)) {
      await resolveNode(child, path);
    } else if (Array.isArray(child)) {
      for (const item of child) await resolveChild(item, path);
    } else if (isLinkRef(child) && isDescriptor(child.target)) {
      // Target descriptors are resolved in place wherever they live in the tree;
      // nothing to do here beyond leaving the reference intact for Layout.
    }
  }

  for (const root of roots) {
    await resolveNode(root, String(root.tag));
  }
  return roots;
}
