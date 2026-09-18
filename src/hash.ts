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
 * Inclusion policy for what feeds a leaf digest (deliberately narrow, so
 * hashes stay portable across machines/checkouts): content, `mode` (since
 * Write only re-`chmod`s a file it actually rewrites -- a mode-only change
 * has to invalidate the hash or it would silently never get applied), the
 * resolved symlink target (hashing *where it points*, never following it),
 * and the current build's `useCollection()` patterns. Deliberately excluded:
 * timestamps, ownership, and any other host-specific metadata.
 *
 * Archive roots (`as="archive"`) are a single atomic .zip file, so their own
 * hash is an aggregate over every descendant. That aggregate is a canonical
 * manifest -- each entry binds a descendant's *relative path* and *kind* to
 * its leaf hash, sorted bytewise by path -- rather than a bag of sorted hash
 * values. Binding path to hash matters: two files swapping content (a.txt
 * and b.txt trade places) changes which path maps to which hash without
 * changing the multiset of hash values, so sorting bare hashes alone would
 * miss it.
 */
import { createHash } from "node:crypto";
import type { ArtifactNode, HashedArtifact, HashResult, LayoutResult } from "./types.js";

export const HASH_ALGORITHM = "sha256";

function sha256(input: string): string {
  return `${HASH_ALGORITHM}:${createHash(HASH_ALGORITHM).update(input).digest("hex")}`;
}

/**
 * Hashes `content` (string or binary Buffer -- SS2.2) followed by a text
 * suffix via two separate `update()` calls rather than string-concatenating
 * first. `hash.update(a).update(b)` is exactly equivalent to
 * `hash.update(a + b)` for a string `a`, so this changes nothing for text
 * content; for a Buffer it avoids coercing binary bytes to a string (which
 * would hash an already-corrupted lossy representation instead of the
 * actual bytes being written).
 */
function sha256WithContent(content: string | Buffer | undefined, suffix: string): string {
  const digest = createHash(HASH_ALGORITHM);
  if (content !== undefined) digest.update(content);
  digest.update(suffix);
  return `${HASH_ALGORITHM}:${digest.digest("hex")}`;
}

function collectDescendants(byId: Map<string, ArtifactNode>, id: string): ArtifactNode[] {
  const node = byId.get(id);
  if (!node) return [];
  const result: ArtifactNode[] = [];
  for (const childId of node.children) {
    const child = byId.get(childId);
    if (child) result.push(child);
    result.push(...collectDescendants(byId, childId));
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

    const suffix = collectionSuffix + (artifact.symlinkTo ?? "") + ` mode:${artifact.mode ?? ""}`;
    leafHashes.set(artifact.id, sha256WithContent(artifact.content, suffix));
  }

  const artifacts: HashedArtifact[] = layoutResult.artifacts.map((artifact) => {
    const isArchiveRoot = artifact.target === "archive" && artifact.archivePath === artifact.outputPath;
    let artifactHash = leafHashes.get(artifact.id)!;
    if (isArchiveRoot) {
      // outputPath is already relative to this archive root (layout.ts resets
      // basePath to "" at every new archive boundary), so it's directly usable
      // as the canonical manifest path.
      const manifest = collectDescendants(layoutResult.byId, artifact.id)
        .map((descendant) => {
          const kind = descendant.symlinkTo !== undefined ? "symlink" : descendant.kind;
          return `${kind}\0${descendant.outputPath}\0${leafHashes.get(descendant.id) ?? ""}`;
        })
        .sort();
      artifactHash = sha256([artifactHash, ...manifest].join("\n"));
    }
    return { ...artifact, hash: artifactHash, dependsOn: dependsOnById.get(artifact.id) ?? [] };
  });

  const byId = new Map(artifacts.map((a) => [a.id, a]));
  return { artifacts, byId, removals: layoutResult.removals, warnings: layoutResult.warnings };
}
