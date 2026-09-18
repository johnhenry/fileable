/**
 * Stage 4: Hash (PRD SS4.4).
 *
 * Each artifact's `content` string, by the time Layout hands it off, already
 * has every inlined fragment and every link()-resolved reference folded in
 * literally -- so hashing the content alone already invalidates a page when
 * a partial it inlines, or data a link() call depends on, changes. The only
 * dependency that ISN'T visible in the content string is `useCollection()`'s
 * source glob (registered at module-eval time, long before any of this runs)
 * -- see the useCollection design note in the PR description for why that's
 * folded into every artifact rather than tracked per-artifact.
 *
 * Archive roots (`as="archive"`) are a single atomic .zip file, so their own
 * hash is an aggregate of every descendant's hash -- otherwise a change deep
 * inside an archive wouldn't be visible at the root and Write would wrongly
 * skip regenerating the .zip.
 */
import { createHash } from "node:crypto";
import type { ArtifactNode, HashedArtifact, HashResult, LayoutResult } from "./types.js";

function sha256(input: string): string {
  return `sha256:${createHash("sha256").update(input).digest("hex")}`;
}

function collectDescendants(byId: Map<string, ArtifactNode>, id: string): string[] {
  const node = byId.get(id);
  if (!node) return [];
  const result: string[] = [];
  for (const childId of node.children) {
    result.push(childId, ...collectDescendants(byId, childId));
  }
  return result;
}

export function hash(layoutResult: LayoutResult, collectionPatterns: string[] = []): HashResult {
  const collectionSuffix = collectionPatterns.length ? ` collections:${collectionPatterns.sort().join(",")}` : "";
  const leafHashes = new Map<string, string>();
  const dependsOnById = new Map<string, string[]>();

  for (const artifact of layoutResult.artifacts) {
    const src = artifact.descriptor.props.src;
    const dependsOn: string[] = [];
    if (typeof src === "string") dependsOn.push(src);
    for (const pattern of collectionPatterns) dependsOn.push(`${pattern} (collection)`);
    dependsOnById.set(artifact.id, dependsOn);

    const digestInput = (artifact.content ?? "") + collectionSuffix + (artifact.symlinkTo ?? "");
    leafHashes.set(artifact.id, sha256(digestInput));
  }

  const artifacts: HashedArtifact[] = layoutResult.artifacts.map((artifact) => {
    const isArchiveRoot = artifact.target === "archive" && artifact.archivePath === artifact.outputPath;
    let artifactHash = leafHashes.get(artifact.id)!;
    if (isArchiveRoot) {
      const descendantHashes = collectDescendants(layoutResult.byId, artifact.id)
        .map((id) => leafHashes.get(id) ?? "")
        .sort();
      artifactHash = sha256([artifactHash, ...descendantHashes].join("|"));
    }
    return { ...artifact, hash: artifactHash, dependsOn: dependsOnById.get(artifact.id) ?? [] };
  });

  const byId = new Map(artifacts.map((a) => [a.id, a]));
  return { artifacts, byId, removals: layoutResult.removals, warnings: layoutResult.warnings };
}
