/**
 * Stage 2: Resolve (PRD SS4.2).
 *
 * Walks the full tree and resolves everything that needs async work:
 *  - `<dir from="glob">` expansion into synthesized `<file src=match>` children
 *  - `<dir src decode>` expansion: decodes an existing zip/wbn archive into
 *    synthesized `<file>` children, the inverse of `encode="zip"`/`encode="wbn"`
 *  - `base64` (decode inline base64-encoded content -- for authoring binary
 *    content directly in JSX with no on-disk file to reference; strictly
 *    validated, see content-util.ts's `decodeBase64Strict`)
 *  - `src` (read a local file, fetch a URL, import a compiled JS/JSX module's
 *    default export as further descriptor children, or await an
 *    already-in-flight Promise<string>)
 *  - `cmd` (shell out, gated by `allowExec` -- PRD SS7.1)
 *  - any other Promise-valued prop, generically
 *
 * `base64`/`src`/`cmd` combine in that order (see content-util.ts's
 * `combineContent`) if more than one is set on the same `<File>`, before
 * any inline JSX text children are appended last (layout.ts).
 *
 * Errors (thrown synchronously or via a rejected promise) are wrapped with
 * the offending node's tree path before propagating (PRD SS6.2).
 *
 *  - `ipfs://<cid>/<path>` (EXAMPLE): both `<File src="ipfs://...">` (a new
 *    URI scheme recognized by the existing `src` prop) and `<IPFS>` (a
 *    genuinely new tag, normalized to `"file"` once resolved -- see its own
 *    doc comment in types.ts) share `fetchIpfs()` below. Two different-sized
 *    answers to "how do I add a new content source" living side by side on
 *    purpose.
 *  - `env://VAR_NAME` (EXAMPLE): another new `src` scheme, the smallest
 *    possible one -- no network, no filesystem, just `process.env`. Missing
 *    throws (fail-loudly, matching every other `src` branch) rather than
 *    silently resolving to empty content.
 *  - `<MarkdownHTML src="...">` (EXAMPLE): a genuinely new tag like `<IPFS>`,
 *    but built entirely from EXISTING pieces -- reuses `loadSrc()` itself
 *    (so `src` can be a local path, `https://`, `ipfs://`, anything the
 *    other branches already support) and the pre-existing
 *    `markdownToHtml()` runtime helper (`markdown.ts`), wiring "load a file,
 *    then run a transform on it" up as a real primitive instead of
 *    something called manually.
 */
import { readFile, stat } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { extname, isAbsolute, relative as relativePath, resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";
import { glob } from "glob";
import { unzipSync } from "fflate";
import * as wbn from "wbn";
import { cloneDescriptorTree, isDescriptor, isLinkRef, isThenable, FileableError } from "./types.js";
import type { Descriptor, DescriptorChild, RenderOptions } from "./types.js";
import { bufferToContent, combineContent, decodeBase64Strict } from "./content-util.js";
import { execCommand } from "./exec.js";
import { recordWarning } from "./context.js";
import { splitGlobBase, toPosixPattern } from "./glob-util.js";
import { ARCHIVE_BASE_URL } from "./wbn-constants.js";
import { markdownToHtml } from "./markdown.js";

const CODE_EXTENSIONS = new Set([".jsx", ".tsx", ".js", ".mjs", ".ts"]);
const DECODE_FORMATS = new Set(["zip", "wbn"]);
const DEFAULT_IPFS_GATEWAY = "https://ipfs.io/ipfs/";

/**
 * EXAMPLE: `ipfs://<cid>/<path>` -> `${gateway}<cid>/<path>`, fetched the
 * same binary-safe way `https://` already is. Shared by both `<File
 * src="ipfs://...">` (below) and `<IPFS>` (in `resolveNode`) -- one real
 * fetch-and-decide-binary-safety implementation, two different tags using it.
 */
async function fetchIpfs(src: string, gateway: string, path: string): Promise<Buffer> {
  const rest = src.slice("ipfs://".length);
  const url = gateway.endsWith("/") ? `${gateway}${rest}` : `${gateway}/${rest}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new FileableError(`ipfs fetch failed: ${src} via ${url} (${res.status})`, path);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function loadSrc(
  src: string,
  baseDir: string,
  path: string,
  ipfsGateway: string,
): Promise<{ content?: string | Buffer; children?: Descriptor[] }> {
  if (/^ipfs:\/\//.test(src)) {
    return { content: bufferToContent(await fetchIpfs(src, ipfsGateway, path)) };
  }
  if (/^env:\/\//.test(src)) {
    const varName = src.slice("env://".length);
    const value = process.env[varName];
    if (value === undefined) {
      throw new FileableError(`env fetch failed: "${varName}" is not set`, path);
    }
    return { content: value };
  }
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
  let matches: string[];
  try {
    // `nodir: true` filters by each entry's own dirent type (an `lstat`,
    // not a followed `stat`) -- a symlink whose *target* is a directory
    // isn't itself a directory dirent, so it survives the filter and comes
    // back as a "file" match. Reading it later then fails with EISDIR
    // (confirmed by actually matching one: `<dir from>` over a tree
    // containing a symlinked subdirectory threw "illegal operation on a
    // directory" instead of silently doing the right thing). glob's own
    // `follow` option (default false) is what keeps `**` from recursing
    // into a symlinked directory in the first place -- and, incidentally,
    // is why this can't loop forever on a symlink cycle either -- so the
    // remaining gap is purely this one dirent-vs-real-type mismatch for a
    // symlink glob matches *directly*, not a general symlink-safety gap.
    const rawMatches = await glob(toPosixPattern(pattern), { cwd: baseDir, absolute: true, nodir: true });
    matches = [];
    for (const match of rawMatches) {
      let isDirectory: boolean;
      try {
        isDirectory = (await stat(match)).isDirectory();
      } catch (cause) {
        // Broken symlink, or a real race (deleted between glob and stat) --
        // either way, there's nothing to read; skip it rather than fail
        // the whole build over one dangling match.
        recordWarning(`\`from\` match "${match}" couldn't be stat'd, skipping: ${(cause as Error).message}`);
        continue;
      }
      if (isDirectory) {
        recordWarning(`\`from\` match "${match}" is a symlink to a directory, skipping (from only matches files)`);
        continue;
      }
      matches.push(match);
    }
  } catch (cause) {
    throw new FileableError(`\`from\` glob expansion failed for "${pattern}"`, path, cause);
  }
  return matches;
}

/** One decoded archive entry: a relative path plus its raw content bytes. */
interface DecodedEntry {
  name: string;
  data: Buffer;
}

function decodeZip(buffer: Buffer, path: string): DecodedEntry[] {
  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(buffer);
  } catch (cause) {
    throw new FileableError("`decode=\"zip\"` failed -- not a valid zip archive", path, cause);
  }
  const entries: DecodedEntry[] = [];
  for (const [name, data] of Object.entries(unzipped)) {
    if (name.endsWith("/")) continue; // directory entry (see write/zip.ts) -- no File to synthesize
    entries.push({ name, data: Buffer.from(data) });
  }
  return entries;
}

function decodeWbn(buffer: Buffer, path: string): DecodedEntry[] {
  let bundle: InstanceType<typeof wbn.Bundle>;
  try {
    bundle = new wbn.Bundle(new Uint8Array(gunzipSync(buffer)));
  } catch (cause) {
    throw new FileableError("`decode=\"wbn\"` failed -- not a valid gzip(application/webbundle) archive", path, cause);
  }
  const entries: DecodedEntry[] = [];
  for (const url of bundle.urls) {
    const name = url.startsWith(ARCHIVE_BASE_URL) ? url.slice(ARCHIVE_BASE_URL.length) : url;
    entries.push({ name, data: Buffer.from(bundle.getResponse(url).body) });
  }
  return entries;
}

async function resolveDirSrc(node: Descriptor, baseDir: string, path: string): Promise<Descriptor[]> {
  const src = node.props.src as string | undefined;
  const decode = node.props.decode as string | undefined;
  if (src === undefined && decode === undefined) return [];
  if (src === undefined) {
    throw new FileableError('`decode` requires `src` to say which archive to decode', path);
  }
  if (decode === undefined) {
    throw new FileableError('`<Dir src>` requires `decode="zip"` or `decode="wbn"` to say how to read it', path);
  }
  if (!DECODE_FORMATS.has(decode)) {
    throw new FileableError(`invalid decode="${decode}" -- expected "zip" or "wbn"`, path);
  }

  const absolute = isAbsolute(src) ? src : resolvePath(baseDir, src);
  let buffer: Buffer;
  try {
    buffer = await readFile(absolute);
  } catch (cause) {
    throw new FileableError(`failed to read archive "${src}"`, path, cause);
  }

  const decoded = decode === "zip" ? decodeZip(buffer, path) : decodeWbn(buffer, path);
  return decoded.map((entry) => ({
    tag: "file" as const,
    props: { name: entry.name, __resolvedContent: bufferToContent(entry.data) },
    children: [],
    __id: `${node.__id}:${entry.name}`,
  }));
}

export async function resolve(
  roots: Descriptor[],
  options: RenderOptions = {},
): Promise<Descriptor[]> {
  const baseDir = options.cwd ?? options.outDir ?? process.cwd();
  const ipfsGateway = options.ipfsGateway ?? DEFAULT_IPFS_GATEWAY;

  async function resolveNode(node: Descriptor, path: string): Promise<void> {
    // EXAMPLE: <IPFS> is a genuinely new tag, not a File in disguise
    // authoring-side -- but the instant its content is fetched, it becomes
    // one. Normalizing the tag here (rather than teaching layout.ts/hash.ts/
    // every writer a fourth structural tag) is the same trick `from="glob"`
    // and `<Dir src decode>` already use: synthesize/relabel into an
    // existing tag once the new primitive's own work is done, so everything
    // downstream stays exactly as simple as it already was.
    if (node.tag === "ipfs") {
      const src = node.props.src as string | undefined;
      if (typeof src !== "string") {
        throw new FileableError("<IPFS> requires a `src` attribute", path);
      }
      const props = node.props as { __resolvedContent?: string | Buffer; src?: string };
      props.__resolvedContent = combineContent(props.__resolvedContent, bufferToContent(await fetchIpfs(src, ipfsGateway, path)));
      // Consumed, not left behind: the node is about to relabel as a plain
      // "file", whose own `src` handling below would otherwise fetch (and
      // double-combine) the exact same content a second time.
      delete props.src;
      node.tag = "file";
    }

    if (node.tag === "markdownhtml") {
      const src = node.props.src as string | undefined;
      if (typeof src !== "string") {
        throw new FileableError("<MarkdownHTML> requires a `src` attribute", path);
      }
      const loaded = await loadSrc(src, baseDir, path, ipfsGateway);
      if (typeof loaded.content !== "string") {
        throw new FileableError(
          `<MarkdownHTML src="${src}"> must resolve to text content -- got ` +
            `${loaded.children ? "a code module (children)" : "binary data"} instead`,
          path,
        );
      }
      const props = node.props as { __resolvedContent?: string | Buffer; src?: string };
      props.__resolvedContent = combineContent(props.__resolvedContent, markdownToHtml(loaded.content));
      delete props.src;
      node.tag = "file";
    }

    if (node.tag === "dir" && node.props.from !== undefined) {
      const fromValue = node.props.from as string | Promise<string[]> | string[];
      const matches = await resolveFromGlob(fromValue, baseDir, path);
      // A pattern's fixed prefix (e.g. "assets" in "assets/**/*") is stripped
      // from each match's path-relative-to-that-prefix, so nested matches
      // keep their subdirectory structure ("img/logo.png") instead of
      // flattening to a bare basename -- which, beyond losing structure,
      // could silently collide (two different "index.html"s in different
      // source dirs landing on the exact same output path with no warning).
      // The prefix is resolved to an absolute path up front (rather than
      // string-prefix-matching it against a path-relative-to-baseDir) so
      // this is correct whether the original pattern was relative or
      // already absolute -- mixing an absolute patternBase against a
      // relative match silently collapsed every match to a bare basename
      // (confirmed by actually matching two same-named files in different
      // subdirs through an absolute `from` pattern -- they landed on the
      // same output path instead of being kept apart).
      const patternBase = typeof fromValue === "string" ? splitGlobBase(toPosixPattern(fromValue)).base : "";
      const absoluteBase = patternBase ? resolvePath(baseDir, patternBase) : baseDir;
      const synthesized: Descriptor[] = matches.map((match) => {
        const name = toPosixPattern(relativePath(absoluteBase, match));
        return {
          tag: "file",
          props: { name, src: match },
          children: [],
          __id: `${node.__id}:${match}`,
        };
      });
      node.children = [...synthesized, ...node.children];
    }

    if (node.tag === "dir") {
      const decoded = await resolveDirSrc(node, baseDir, path);
      if (decoded.length > 0) {
        // Editable, not a collision: an explicit child sharing a decoded
        // entry's name wins outright (unlike every other artifact-path
        // collision in this codebase, which throws) -- "unpack, then
        // override a few files" is the point of this feature, not a
        // mistake to guard against. Only this <Dir>'s own direct children
        // are checked; a decoded entry can't collide with something nested
        // deeper (e.g. inside a further <Dir>), since its own `name` is
        // always a single path segment relative to this level.
        const explicitNames = new Set(
          node.children
            .filter((child): child is Descriptor => isDescriptor(child))
            .map((child) => child.props.name)
            .filter((name): name is string => typeof name === "string"),
        );
        const nonOverridden = decoded.filter((entry) => !explicitNames.has(entry.props.name as string));
        node.children = [...nonOverridden, ...node.children];
      }
    }

    if (node.tag === "file") {
      const props = node.props as { __resolvedContent?: string | Buffer };

      const base64 = node.props.base64 as string | undefined;
      if (base64 !== undefined) {
        const decoded = decodeBase64Strict(base64, path);
        // bufferToContent, not the raw Buffer directly -- matches src=/cmd='s
        // own UTF-8-round-trip handling exactly (content-util.ts), so
        // base64-encoded text content stays a plain string like every other
        // text content source, not an unconditional Buffer.
        props.__resolvedContent = combineContent(props.__resolvedContent, bufferToContent(decoded));
      }

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
          const loaded = await loadSrc(src, baseDir, path, ipfsGateway);
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
