/**
 * Stage 3: Layout (PRD SS4.3).
 *
 * Three passes over the already-resolved tree:
 *  1. Walk top-down, assigning output paths to every non-inlined `<dir>`/`<file>`
 *     (nameless inlining, SS5.1) and recording an identity map from every
 *     descriptor -> the real artifact its content ultimately lands in.
 *  2. Walk again, substituting every LinkRef and `symlink` reference now that
 *     the path table is complete (SS6.1, SS5.3), and recording which
 *     descriptors are actually referenced as same-artifact anchor targets.
 *  3. Serialize every real artifact's content (base `src`/`cmd` content plus
 *     its inlined children, per its `join` attribute).
 */
import * as posixPath from "./posix-path.js";
import { isDescriptor, isLinkRef, FileableError } from "./types.js";
import type {
  ArtifactNode,
  Descriptor,
  DescriptorChild,
  LayoutResult,
  LinkOptions,
  LinkRef,
  RemovalSpec,
  RenderOptions,
  RenderTarget,
} from "./types.js";
import { parseJoin, serializeChildren } from "./serialize.js";
import { unsafeArchivePathReason } from "./archive-path.js";

/**
 * #31: an output path (relative to outDir for loose artifacts and archive
 * files, relative to the archive for entries inside one) must pass the same
 * rule `<Dir src decode>` applies to entry names. It is checked after
 * joining and normalizing, so `<File name="a/../b">` is fine (it lands on
 * `b`) but anything that climbs out (`..`, `a/../../b`), is absolute, has a
 * drive letter, backslash or control character is refused. The one
 * exception is a `<Dir name=".">`, which means outDir itself.
 */
function unsafeOutputPathReason(outputPath: string, isDir: boolean): string | undefined {
  if (isDir && outputPath === ".") return undefined;
  const trimmed = isDir && outputPath.length > 1 && outputPath.endsWith("/") ? outputPath.slice(0, -1) : outputPath;
  return unsafeArchivePathReason(trimmed);
}

/**
 * The key two paths share when a case-insensitive or Unicode-normalizing
 * filesystem (macOS and Windows defaults) would treat them as one: NFC, then
 * lowercase. Folding is the same on every platform, so a tree that would
 * collide on one filesystem is refused on all of them (#31).
 */
export function pathFoldKey(path: string): string {
  return path.normalize("NFC").toLowerCase().normalize("NFC");
}

function unsafeOutputPath(outputPath: string, reason: string, path: string, inside?: string): FileableError {
  return new FileableError(
    `unsafe output path ${JSON.stringify(outputPath)} (${reason})${inside ? ` inside ${inside}` : ""} -- ` +
      "output paths must be relative and stay inside outDir (and inside their archive)",
    path, undefined, "E_UNSAFE_PATH",
  );
}

/**
 * Same-build collisions a case-insensitive or normalizing filesystem would
 * create (#31): two artifacts whose paths fold to the same key, or an
 * artifact under a path another artifact writes as a file (a regular file,
 * a symlink, or an archive) -- e.g. a decoded entry `link/x` next to a
 * template's `<File name="link" symlink>`. Both throw E_PATH_CONFLICT on
 * every platform instead of depending on the filesystem.
 */
function assertNoFoldedConflicts(artifacts: ArtifactNode[]): void {
  const namespace = (a: ArtifactNode) => (a.target === "loose" || a.containerPath === a.outputPath ? "" : `${a.containerPath}::`);
  const strip = (p: string) => (p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p);
  const byKey = new Map<string, ArtifactNode>();
  for (const artifact of artifacts) {
    const key = namespace(artifact) + pathFoldKey(strip(artifact.outputPath));
    const other = byKey.get(key);
    if (other) {
      throw new FileableError(
        `output paths "${other.outputPath}" and "${artifact.outputPath}" differ only in case or Unicode normalization -- ` +
          "they are the same file on a case-insensitive or normalizing filesystem (macOS, Windows)",
        artifact.outputPath, undefined, "E_PATH_CONFLICT",
      );
    }
    byKey.set(key, artifact);
  }
  for (const artifact of artifacts) {
    const segments = strip(artifact.outputPath).split("/");
    for (let i = 1; i < segments.length; i++) {
      const parent = byKey.get(namespace(artifact) + pathFoldKey(segments.slice(0, i).join("/")));
      if (!parent) continue;
      const isArchive = parent.target !== "loose" && parent.containerPath === parent.outputPath;
      if (parent.kind !== "file" && !isArchive) continue;
      const what = isArchive ? "an archive file" : parent.descriptor.props.symlink !== undefined ? "a symlink" : "a file";
      throw new FileableError(
        `output path "${artifact.outputPath}" would be written inside "${parent.outputPath}", which this build writes as ${what}`,
        artifact.outputPath, undefined, "E_PATH_CONFLICT",
      );
    }
  }
}

interface IdentityInfo {
  realArtifactId: string;
  anchorId: string;
  doctype?: string;
}

interface WalkCtx {
  basePath: string;
  target: RenderTarget;
  containerPath?: string;
  insideFile: boolean;
  nearestDoctype?: string;
}

const CONTAINER_EXTENSIONS: Record<"zip" | "wbn", string> = { zip: "zip", wbn: "wbn" };

interface PendingSymlink {
  artifactId: string;
  targetRef: Descriptor | string;
  path: string;
}

export function layout(roots: Descriptor[], options: RenderOptions = {}): LayoutResult {
  const artifacts: ArtifactNode[] = [];
  const byId = new Map<string, ArtifactNode>();
  const identity = new Map<Descriptor, IdentityInfo>();
  const removals: RemovalSpec[] = [];
  const warnings: string[] = [];
  const pendingSymlinks: PendingSymlink[] = [];
  const usedAnchors = new Set<Descriptor>();
  let anchorCounter = 0;
  const nextAnchorId = () => `fileable-${anchorCounter++}`;

  function addArtifact(node: ArtifactNode, parentId: string | null, path: string): void {
    // Two artifacts landing on the same output path (e.g. two <dir from>
    // matches sharing a basename, or a plain authoring mistake) would
    // otherwise silently collide: both get written, whichever runs last in
    // Write wins, with no trace anything was lost.
    if (byId.has(node.id)) {
      throw new FileableError(`duplicate output path "${node.outputPath}" -- two artifacts both resolve here`, path, undefined, "E_PATH_CONFLICT");
    }
    const isEntry = node.target !== "loose" && node.containerPath !== node.outputPath;
    const reason = unsafeOutputPathReason(node.outputPath, node.kind === "dir" && !isEntry);
    if (reason !== undefined) throw unsafeOutputPath(node.outputPath, reason, path, isEntry ? node.containerPath : undefined);
    artifacts.push(node);
    byId.set(node.id, node);
    if (parentId) byId.get(parentId)?.children.push(node.id);
  }

  // --- Pass 1: identity + path assignment -----------------------------------
  function walk(node: Descriptor, ctx: WalkCtx, parentId: string | null, path: string): void {
    if (node.tag === "rm") {
      if (ctx.target === "loose") {
        const kind = (node.props.kind as string | undefined) ?? "file";
        if (kind !== "file" && kind !== "dir" && kind !== "any") {
          throw new FileableError(`invalid kind="${kind}" -- expected "file", "dir", or "any"`, path, undefined, "E_INVALID_PROP");
        }
        const onMissing = (node.props.onMissing as string | undefined) ?? "ignore";
        if (onMissing !== "ignore" && onMissing !== "warn" && onMissing !== "error") {
          throw new FileableError(`invalid onMissing="${onMissing}" -- expected "ignore", "warn", or "error"`, path, undefined, "E_INVALID_PROP");
        }
        // Joining a negated target ("!*.draft.html") directly with basePath
        // would bury the leading "!" mid-string (e.g. "site/!*.draft.html"),
        // so the negation marker is stripped, joined, then reattached.
        const target = node.props.target as string;
        const negated = target.startsWith("!");
        const joined = posixPath.join(ctx.basePath, negated ? target.slice(1) : target);
        // An <Rm> deletes, so its target gets the same containment rule as
        // a write (#31). "**" or "*.tmp" are fine; "../x" is not.
        const rmReason = joined === "." ? undefined : unsafeOutputPathReason(joined, true);
        if (rmReason !== undefined) throw unsafeOutputPath(joined, rmReason, path);
        removals.push({
          pattern: negated ? `!${joined}` : joined,
          kind,
          emptyOnly: !!node.props.emptyOnly,
          onMissing,
          deletable: node.props.deletable as RemovalSpec["deletable"],
        });
      }
      return;
    }

    if (node.tag === "dir") {
      const name = node.props.name as string | undefined;
      if (!ctx.insideFile && !name) {
        throw new FileableError("<dir> requires a `name` attribute", path, undefined, "E_INVALID_PROP");
      }
      if (ctx.insideFile) {
        identity.set(node, {
          realArtifactId: parentId!,
          anchorId: nextAnchorId(),
          doctype: ctx.nearestDoctype,
        });
        for (const child of node.children) {
          walkChild(child, ctx, parentId, `${path} > dir[${name ?? ""}]`);
        }
        return;
      }

      const requestedEncode = node.props.encode as RenderTarget | undefined;
      if (requestedEncode !== undefined && requestedEncode !== "loose" && requestedEncode !== "zip" && requestedEncode !== "wbn") {
        throw new FileableError(
          `invalid encode="${String(requestedEncode)}" -- expected "loose", "zip", or "wbn"`,
          path, undefined, "E_INVALID_PROP",
        );
      }
      // Any explicit <Dir encode> nested inside a container (zip/wbn) used
      // to be silently ignored for "zip": encode="zip" again (starting a
      // *second*, nested zip) fell through to "regular nested dir" (still
      // just an entry in the outer zip, losing the "start a fresh zip"
      // request), and encode="loose" (escaping back out) stayed archived
      // either way -- neither nested containers, switching container
      // formats mid-tree, nor escaping back to loose from inside one are
      // supported, so all of these fail loudly instead of doing the wrong
      // thing quietly.
      if (requestedEncode !== undefined && ctx.target !== "loose") {
        throw new FileableError(
          `<Dir encode="${requestedEncode}"> nested inside a "${ctx.target}" container can't change render target -- ` +
            "nested containers, switching container formats, and escaping back to loose mid-tree aren't supported",
          path, undefined, "E_INVALID_PROP",
        );
      }
      const nextChildCtx: WalkCtx = { ...ctx };
      let artifactId: string;
      if (requestedEncode === "zip" || requestedEncode === "wbn") {
        const containerPath = posixPath.join(ctx.basePath, `${name}.${CONTAINER_EXTENSIONS[requestedEncode]}`);
        artifactId = containerPath;
        addArtifact(
          {
            id: artifactId,
            kind: "dir",
            descriptor: node,
            outputPath: containerPath,
            target: requestedEncode,
            containerPath,
            mode: node.props.mode as string | undefined,
            children: [],
          },
          parentId,
          path,
        );
        nextChildCtx.basePath = "";
        nextChildCtx.target = requestedEncode;
        nextChildCtx.containerPath = containerPath;
      } else {
        const outputPath = posixPath.join(ctx.basePath, name!);
        artifactId = ctx.target !== "loose" ? `${ctx.containerPath}::${outputPath}` : outputPath;
        addArtifact(
          {
            id: artifactId,
            kind: "dir",
            descriptor: node,
            outputPath,
            target: ctx.target,
            containerPath: ctx.containerPath,
            mode: node.props.mode as string | undefined,
            children: [],
          },
          parentId,
          path,
        );
        nextChildCtx.basePath = outputPath;
      }
      identity.set(node, { realArtifactId: artifactId, anchorId: nextAnchorId(), doctype: ctx.nearestDoctype });
      for (const child of node.children) {
        walkChild(child, nextChildCtx, artifactId, `${path} > dir[${name}]`);
      }
      return;
    }

    if (node.tag === "file") {
      const name = node.props.name as string | undefined;
      const doctype = (node.props.doctype as string | undefined) ?? ctx.nearestDoctype;
      if (ctx.insideFile) {
        identity.set(node, { realArtifactId: parentId!, anchorId: nextAnchorId(), doctype });
        const childCtx: WalkCtx = { ...ctx, insideFile: true, nearestDoctype: doctype };
        for (const child of node.children) {
          walkChild(child, childCtx, parentId, `${path} > file[${name ?? ""}]`);
        }
        return;
      }
      if (!name) {
        throw new FileableError("<file> requires a `name` attribute", path, undefined, "E_INVALID_PROP");
      }
      const outputPath = posixPath.join(ctx.basePath, name);
      const artifactId = ctx.target !== "loose" ? `${ctx.containerPath}::${outputPath}` : outputPath;
      addArtifact(
        {
          id: artifactId,
          kind: "file",
          descriptor: node,
          outputPath,
          target: ctx.target,
          containerPath: ctx.containerPath,
          mode: node.props.mode as string | undefined,
          children: [],
        },
        parentId,
        path,
      );
      identity.set(node, { realArtifactId: artifactId, anchorId: nextAnchorId(), doctype });

      if (node.props.symlink !== undefined) {
        pendingSymlinks.push({
          artifactId,
          targetRef: node.props.symlink as Descriptor | string,
          path: `${path} > file[${name}][symlink]`,
        });
      }

      const childCtx: WalkCtx = { ...ctx, insideFile: true, nearestDoctype: doctype };
      for (const child of node.children) {
        walkChild(child, childCtx, artifactId, `${path} > file[${name}]`);
      }
      return;
    }

    // Generic markup tag: transparent for identity purposes, just recurse.
    for (const child of node.children) {
      walkChild(child, ctx, parentId, `${path} > ${String(node.tag)}`);
    }
  }

  function walkChild(child: DescriptorChild, ctx: WalkCtx, parentId: string | null, path: string): void {
    if (isDescriptor(child)) walk(child, ctx, parentId, path);
    else if (Array.isArray(child)) for (const c of child) walkChild(c, ctx, parentId, path);
  }

  for (const root of roots) {
    walk(root, { basePath: "", target: "loose", insideFile: false }, null, String(root.tag));
  }

  assertNoFoldedConflicts(artifacts);

  // --- Symlink resolution (needs the complete identity map) -----------------
  for (const pending of pendingSymlinks) {
    const artifact = byId.get(pending.artifactId)!;
    let targetOutputPath: string;
    let targetRealArtifactId: string | undefined;
    let targetArtifact: ArtifactNode | undefined;
    // A string target is the literal symlink text (same semantics as `ln -s
    // TARGET LINK` -- interpreted relative to the symlink's own directory),
    // so it's never run through the root-relative-path computation below,
    // unlike a Descriptor target's outputPath (which genuinely *is* rooted
    // and needs converting to be relative to the symlink instead).
    const targetIsLiteral = typeof pending.targetRef === "string";
    if (typeof pending.targetRef === "string") {
      targetOutputPath = pending.targetRef;
    } else {
      const info = identity.get(pending.targetRef);
      if (!info) {
        throw new FileableError("symlink target is not a descriptor present in this tree", pending.path, undefined, "E_SYMLINK");
      }
      targetRealArtifactId = info.realArtifactId;
      targetArtifact = byId.get(info.realArtifactId);
      targetOutputPath = targetArtifact ? targetArtifact.outputPath : "";
      usedAnchors.add(pending.targetRef);
    }
    if (artifact.target !== "loose") {
      artifact.symlinkDegraded = true;
      const message =
        `symlink to ${targetOutputPath} was materialized as a copy because target format ` +
        `"${artifact.target}" does not support links.`;
      if (options.strict) {
        throw new FileableError(message, pending.path, undefined, "E_SYMLINK");
      }
      warnings.push(message);
    } else if (!targetIsLiteral && targetArtifact && targetArtifact.target !== "loose") {
      // The symlink itself is loose (a real `fs.symlink` will be attempted),
      // but the target lives inside a container (zip/wbn) -- there's
      // no real filesystem path a symlink could point at; `targetOutputPath`
      // above is only meaningful relative to the container's own internal
      // root, not the real filesystem. Silently emitting a symlink to that
      // non-path would "succeed" while pointing at nothing (confirmed by
      // actually building this case: the resulting symlink target didn't
      // exist anywhere).
      throw new FileableError(
        `symlink target "${targetOutputPath}" lives inside a "${targetArtifact.target}" container (${targetArtifact.containerPath}) -- ` +
          "a real symlink needs a real filesystem path; content inside a container has no addressable path outside it",
        pending.path, undefined, "E_SYMLINK",
      );
    } else {
      // Real symlink is attempted first at Write time; __copyFromId is kept as
      // a fallback for the Windows EPERM case (SS5.3), where Write degrades to
      // a copy on the fly without needing Layout to know about it in advance.
      artifact.symlinkTo = targetIsLiteral
        ? targetOutputPath
        : posixPath.relative(posixPath.dirname(artifact.outputPath), targetOutputPath);
    }
    (artifact as ArtifactNode & { __copyFromId?: string }).__copyFromId = targetRealArtifactId;
  }

  // --- Pass 2: LinkRef substitution ------------------------------------------
  function resolveLinkRefString(ref: LinkRef, currentArtifactId: string, currentDoctype: string | undefined): string {
    const format: NonNullable<LinkOptions["format"]> =
      ref.options?.format ?? (currentDoctype === "markdown" ? "markdown" : "html");
    let hrefValue: string;
    if (typeof ref.target === "string") {
      hrefValue = ref.target;
    } else {
      const info = identity.get(ref.target);
      if (!info) {
        throw new FileableError("linkTo() target is not a descriptor present in this tree", "linkTo()", undefined, "E_LINK");
      }
      if (info.realArtifactId === currentArtifactId) {
        usedAnchors.add(ref.target);
        hrefValue = `#${info.anchorId}`;
      } else {
        const targetArtifact = byId.get(info.realArtifactId);
        const currentArtifact = byId.get(currentArtifactId);
        if (targetArtifact && currentArtifact && targetArtifact.target === currentArtifact.target) {
          hrefValue = posixPath.relative(posixPath.dirname(currentArtifact.outputPath), targetArtifact.outputPath);
        } else {
          hrefValue = targetArtifact?.outputPath ?? "";
        }
      }
    }
    if (format === "markdown") {
      return `[${ref.options?.text ?? hrefValue}](${hrefValue})`;
    }
    return hrefValue;
  }

  // `identity` only has entries for `dir`/`file` nodes (Pass 1 only assigns
  // artifact/anchor identity to structural nodes). Generic markup nodes
  // (e.g. the <a> that actually holds a linkTo() result in its `href` prop)
  // have no identity of their own -- they inherit whichever real artifact
  // their nearest dir/file ancestor resolved to, threaded down explicitly
  // here rather than looked up per-node.
  function substitute(
    node: Descriptor,
    inheritedArtifactId: string | undefined,
    inheritedDoctype: string | undefined,
  ): void {
    const info = identity.get(node);
    const currentArtifactId = info?.realArtifactId ?? inheritedArtifactId;
    const currentDoctype = info?.doctype ?? inheritedDoctype;

    for (const [key, value] of Object.entries(node.props)) {
      if (isLinkRef(value) && currentArtifactId) {
        node.props[key] = resolveLinkRefString(value, currentArtifactId, currentDoctype);
      }
    }
    node.children = substituteChildren(node.children, currentArtifactId, currentDoctype);
  }

  function substituteChildren(
    children: DescriptorChild[],
    currentArtifactId: string | undefined,
    currentDoctype: string | undefined,
  ): DescriptorChild[] {
    return children.map((child): DescriptorChild => {
      if (Array.isArray(child)) return substituteChildren(child, currentArtifactId, currentDoctype);
      if (isLinkRef(child) && currentArtifactId) {
        return resolveLinkRefString(child, currentArtifactId, currentDoctype);
      }
      if (isDescriptor(child)) {
        substitute(child, currentArtifactId, currentDoctype);
        return child;
      }
      return child;
    });
  }

  for (const root of roots) substitute(root, undefined, undefined);

  // --- Pass 3: content serialization -----------------------------------------
  const anchorIds = new Map<Descriptor, string>();
  for (const [descriptor, info] of identity) {
    if (usedAnchors.has(descriptor)) anchorIds.set(descriptor, info.anchorId);
  }

  for (const artifact of artifacts) {
    if (artifact.kind !== "file") continue;
    if (artifact.symlinkTo !== undefined) continue;
    const node = artifact.descriptor;
    const join = parseJoin(node.props, artifact.outputPath);
    const base = (node.props as { __resolvedContent?: string | Buffer | Uint8Array }).__resolvedContent;
    const inner = serializeChildren(node.children, join, { anchorIds });
    if (base === undefined) {
      artifact.content = inner;
    } else if (typeof base === "string") {
      artifact.content = base + inner;
    } else if (inner === "") {
      // Binary base content (a Buffer, from a binary src/cmd -- SS2.2) with
      // no markup children stays byte-exact.
      artifact.content = base;
    } else {
      // Splicing JSX markup into binary base content (unusual -- text
      // content doesn't compose with raw binary bytes meaningfully) falls
      // back to a plain byte concat rather than erroring, since it's what
      // was literally authored. A manual Uint8Array concat instead of
      // `Buffer.concat`/`Buffer.from` -- `Buffer` is a Node global with no
      // browser equivalent (issue #6); `base` is already raw bytes (a Node
      // Buffer *is* a Uint8Array) either way, so this changes nothing for
      // the existing Node write path (`fs.writeFile`/`fflate` both already
      // accept a plain Uint8Array, per write/zip.ts's own comment).
      const innerBytes = new TextEncoder().encode(inner);
      const combined = new Uint8Array(base.length + innerBytes.length);
      combined.set(base, 0);
      combined.set(innerBytes, base.length);
      artifact.content = combined;
    }
  }
  for (const artifact of artifacts) {
    const copyFromId = (artifact as ArtifactNode & { __copyFromId?: string }).__copyFromId;
    if (copyFromId) {
      artifact.content = byId.get(copyFromId)?.content ?? "";
    }
  }

  return { artifacts, byId, removals, warnings };
}
