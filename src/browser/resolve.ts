/**
 * Browser-safe Stage 2 (Resolve), the browser/core counterpart of
 * ../resolve.ts. ../resolve.ts statically imports `node:fs/promises`,
 * `node:zlib`, `node:path`, and `node:url` -- even though most of that only
 * actually *executes* for local `src=` file reads, `<Dir src decode>`
 * archive decoding, and compiled-module `src=` imports, the imports
 * themselves are enough to break a strict browser bundle target (issue #6
 * asks for zero `node:*` imports anywhere in this entry point's module
 * graph, not just zero *reachable* ones).
 *
 * This module supports the subset of Resolve's behavior that has a real
 * browser equivalent -- everything reachable via `fetch` (already a
 * standard browser API, and global in Node too) or already-in-memory data:
 *  - `base64` (decode inline content, via browser/content-util.ts)
 *  - `src="https://..."` / `src="http://..."` (via `fetch`)
 *  - `src="ipfs://<cid>/<path>"` on `<File>` or `<IPFS>` (via `fetch`
 *    against `options.ipfsGateway`, same URL construction as ../resolve.ts)
 *  - `src` as an already-in-flight `Promise<string>`
 *  - `<MarkdownHTML src="...">` (reuses this module's own `loadSrc()`, same
 *    "load a file, then transform it" wiring ../resolve.ts uses)
 *  - any other Promise-valued prop, generically
 *
 * What genuinely has no browser equivalent -- a local filesystem `src=`
 * path, a compiled-module `src=` import, `<Dir from="glob">` (needs real
 * `fs`/`glob`), `<Dir src decode>` (needs `fs`+`zlib`/`wbn`), and `cmd`
 * (needs `child_process`) -- throws a clear `FileableError` pointing back
 * at the Node entry point (`@johnhenry/fileable`) rather than silently
 * doing nothing, matching this codebase's fail-loudly convention.
 * `env://VAR_NAME` is excluded for the same reason: there's no
 * `process.env` in a browser.
 */
import { cloneDescriptorTree, isDescriptor, isLinkRef, isThenable, FileableError } from "../types.js";
import type { Descriptor, DescriptorChild, RenderOptions } from "../types.js";
import { bufferToContent, combineContent, decodeBase64Strict } from "./content-util.js";
import { markdownToHtml } from "../markdown.js";

const DEFAULT_IPFS_GATEWAY = "https://ipfs.io/ipfs/";

function unsupportedInBrowser(what: string, path: string): FileableError {
  return new FileableError(
    `${what} requires real filesystem/process access, which isn't available in the browser-safe ` +
      `"@johnhenry/fileable/browser" entry point -- use the Node entry point (\`import { render } from ` +
      `"@johnhenry/fileable"\`) for this tree instead`,
    path,
  );
}

async function fetchIpfs(src: string, gateway: string, path: string): Promise<Uint8Array> {
  const rest = src.slice("ipfs://".length);
  const url = gateway.endsWith("/") ? `${gateway}${rest}` : `${gateway}/${rest}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new FileableError(`ipfs fetch failed: ${src} via ${url} (${res.status})`, path);
  }
  return new Uint8Array(await res.arrayBuffer());
}

async function loadSrc(
  src: string,
  path: string,
  ipfsGateway: string,
): Promise<{ content?: string | Uint8Array }> {
  if (/^ipfs:\/\//.test(src)) {
    return { content: bufferToContent(await fetchIpfs(src, ipfsGateway, path)) };
  }
  if (/^env:\/\//.test(src)) {
    throw unsupportedInBrowser(`\`src="${src}"\` (env:// reads process.env)`, path);
  }
  if (/^https?:\/\//.test(src)) {
    const res = await fetch(src);
    if (!res.ok) {
      throw new FileableError(`src fetch failed: ${src} (${res.status})`, path);
    }
    return { content: bufferToContent(new Uint8Array(await res.arrayBuffer())) };
  }
  throw unsupportedInBrowser(`\`src="${src}"\` (a local filesystem/compiled-module path)`, path);
}

export async function resolve(
  roots: Descriptor[],
  options: RenderOptions = {},
): Promise<Descriptor[]> {
  const ipfsGateway = options.ipfsGateway ?? DEFAULT_IPFS_GATEWAY;

  async function resolveNode(node: Descriptor, path: string): Promise<void> {
    if (node.tag === "ipfs") {
      const src = node.props.src as string | undefined;
      if (typeof src !== "string") {
        throw new FileableError("<IPFS> requires a `src` attribute", path);
      }
      const props = node.props as { __resolvedContent?: string | Uint8Array; src?: string };
      props.__resolvedContent = combineContent(props.__resolvedContent, bufferToContent(await fetchIpfs(src, ipfsGateway, path)));
      delete props.src;
      node.tag = "file";
    }

    if (node.tag === "markdownhtml") {
      const src = node.props.src as string | undefined;
      if (typeof src !== "string") {
        throw new FileableError("<MarkdownHTML> requires a `src` attribute", path);
      }
      const loaded = await loadSrc(src, path, ipfsGateway);
      if (typeof loaded.content !== "string") {
        throw new FileableError(`<MarkdownHTML src="${src}"> must resolve to text content -- got binary data instead`, path);
      }
      const props = node.props as { __resolvedContent?: string | Uint8Array; src?: string };
      props.__resolvedContent = combineContent(props.__resolvedContent, markdownToHtml(loaded.content));
      delete props.src;
      node.tag = "file";
    }

    if (node.tag === "dir" && node.props.from !== undefined) {
      throw unsupportedInBrowser("`<Dir from>` (glob expansion)", path);
    }
    if (node.tag === "dir" && (node.props.src !== undefined || node.props.decode !== undefined)) {
      throw unsupportedInBrowser("`<Dir src decode>` (archive decoding)", path);
    }

    if (node.tag === "file") {
      const props = node.props as { __resolvedContent?: string | Uint8Array };

      const base64 = node.props.base64 as string | undefined;
      if (base64 !== undefined) {
        const decoded = decodeBase64Strict(base64, path);
        props.__resolvedContent = combineContent(props.__resolvedContent, bufferToContent(decoded));
      }

      const src = node.props.src as string | Promise<string> | undefined;
      if (src !== undefined) {
        if (isThenable(src)) {
          try {
            props.__resolvedContent = combineContent(props.__resolvedContent, await src);
          } catch (cause) {
            throw new FileableError("`src` promise rejected", path, cause);
          }
        } else {
          const loaded = await loadSrc(src, path, ipfsGateway);
          if (loaded.content !== undefined) {
            props.__resolvedContent = combineContent(props.__resolvedContent, loaded.content);
          }
        }
      }

      const cmd = node.props.cmd as string | undefined;
      if (cmd !== undefined) {
        throw unsupportedInBrowser("`cmd` (shelling out)", path);
      }
    }

    // Generic fallback: any other promise-valued prop (future-proofing per SS4.1), same as ../resolve.ts.
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
      // Target descriptors are resolved in place wherever they live in the tree; nothing to do here (Layout handles it).
    }
  }

  for (const root of roots) {
    await resolveNode(root, String(root.tag));
  }
  return roots;
}

// Re-exported for anything (e.g. a caller building its own dry-run tooling)
// that wants to clone a tree the same way render()'s Node entry point does.
export { cloneDescriptorTree };
