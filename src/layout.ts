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
import posixPath from "node:path/posix";
import { isDescriptor, isLinkRef, FileableError } from "./types.js";
import type {
  ArtifactNode,
  Descriptor,
  DescriptorChild,
  LayoutResult,
  LinkOptions,
  LinkRef,
  RenderOptions,
  RenderTarget,
} from "./types.js";
import { serializeChildren } from "./serialize.js";

interface IdentityInfo {
  realArtifactId: string;
  anchorId: string;
  doctype?: string;
}

interface WalkCtx {
  basePath: string;
  target: RenderTarget;
  archivePath?: string;
  insideFile: boolean;
  nearestDoctype?: string;
}

interface PendingSymlink {
  artifactId: string;
  targetRef: Descriptor | string;
  path: string;
}

export function layout(roots: Descriptor[], options: RenderOptions = {}): LayoutResult {
  const artifacts: ArtifactNode[] = [];
  const byId = new Map<string, ArtifactNode>();
  const identity = new Map<Descriptor, IdentityInfo>();
  const removals: string[] = [];
  const warnings: string[] = [];
  const pendingSymlinks: PendingSymlink[] = [];
  const usedAnchors = new Set<Descriptor>();
  let anchorCounter = 0;
  const nextAnchorId = () => `fileable-${anchorCounter++}`;

  function addArtifact(node: ArtifactNode, parentId: string | null): void {
    artifacts.push(node);
    byId.set(node.id, node);
    if (parentId) byId.get(parentId)?.children.push(node.id);
  }

  // --- Pass 1: identity + path assignment -----------------------------------
  function walk(node: Descriptor, ctx: WalkCtx, parentId: string | null, path: string): void {
    if (node.tag === "rm") {
      if (ctx.target === "loose") {
        removals.push(posixPath.join(ctx.basePath, node.props.target as string));
      }
      return;
    }

    if (node.tag === "dir") {
      const name = node.props.name as string | undefined;
      if (!ctx.insideFile && !name) {
        throw new FileableError("<dir> requires a `name` attribute", path);
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

      const requestedAs = node.props.as as RenderTarget | undefined;
      const nextChildCtx: WalkCtx = { ...ctx };
      let artifactId: string;
      if (requestedAs === "archive" && ctx.target !== "archive") {
        const zipPath = posixPath.join(ctx.basePath, `${name}.zip`);
        artifactId = zipPath;
        addArtifact(
          {
            id: artifactId,
            kind: "dir",
            descriptor: node,
            outputPath: zipPath,
            target: "archive",
            archivePath: zipPath,
            mode: node.props.mode as string | undefined,
            children: [],
          },
          parentId,
        );
        nextChildCtx.basePath = "";
        nextChildCtx.target = "archive";
        nextChildCtx.archivePath = zipPath;
      } else {
        const outputPath = posixPath.join(ctx.basePath, name!);
        artifactId = ctx.target === "archive" ? `${ctx.archivePath}::${outputPath}` : outputPath;
        addArtifact(
          {
            id: artifactId,
            kind: "dir",
            descriptor: node,
            outputPath,
            target: ctx.target,
            archivePath: ctx.archivePath,
            mode: node.props.mode as string | undefined,
            children: [],
          },
          parentId,
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
        throw new FileableError("<file> requires a `name` attribute", path);
      }
      const outputPath = posixPath.join(ctx.basePath, name);
      const artifactId = ctx.target === "archive" ? `${ctx.archivePath}::${outputPath}` : outputPath;
      addArtifact(
        {
          id: artifactId,
          kind: "file",
          descriptor: node,
          outputPath,
          target: ctx.target,
          archivePath: ctx.archivePath,
          mode: node.props.mode as string | undefined,
          children: [],
        },
        parentId,
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

  // --- Symlink resolution (needs the complete identity map) -----------------
  for (const pending of pendingSymlinks) {
    const artifact = byId.get(pending.artifactId)!;
    let targetOutputPath: string;
    let targetRealArtifactId: string | undefined;
    if (typeof pending.targetRef === "string") {
      targetOutputPath = pending.targetRef;
    } else {
      const info = identity.get(pending.targetRef);
      if (!info) {
        throw new FileableError("symlink target is not a descriptor present in this tree", pending.path);
      }
      targetRealArtifactId = info.realArtifactId;
      const targetArtifact = byId.get(info.realArtifactId);
      targetOutputPath = targetArtifact ? targetArtifact.outputPath : "";
      usedAnchors.add(pending.targetRef);
    }
    if (artifact.target !== "loose") {
      artifact.symlinkDegraded = true;
      const message =
        `symlink to ${targetOutputPath} was materialized as a copy because target format ` +
        `"${artifact.target}" does not support links.`;
      if (options.strict) {
        throw new FileableError(message, pending.path);
      }
      warnings.push(message);
    } else {
      // Real symlink is attempted first at Write time; __copyFromId is kept as
      // a fallback for the Windows EPERM case (SS5.3), where Write degrades to
      // a copy on the fly without needing Layout to know about it in advance.
      artifact.symlinkTo = posixPath.relative(posixPath.dirname(artifact.outputPath), targetOutputPath);
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
        throw new FileableError("link() target is not a descriptor present in this tree", "link()");
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
  // (e.g. the <a> that actually holds a link() result in its `href` prop)
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
    const join = (node.props.join as "concat" | "dom-merge") ?? "concat";
    const base = (node.props as { __resolvedContent?: string }).__resolvedContent ?? "";
    artifact.content = base + serializeChildren(node.children, join, { anchorIds });
  }
  for (const artifact of artifacts) {
    const copyFromId = (artifact as ArtifactNode & { __copyFromId?: string }).__copyFromId;
    if (copyFromId) {
      artifact.content = byId.get(copyFromId)?.content ?? "";
    }
  }

  return { artifacts, byId, removals, warnings };
}
