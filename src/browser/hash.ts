/**
 * Browser-safe Stage 4 (Hash), the browser/core counterpart of ../hash.ts.
 * Uses Web Crypto's `crypto.subtle.digest("SHA-256", ...)` instead of
 * `node:crypto`'s `createHash("sha256")` -- `node:crypto` is a Node-only
 * import Vite/esbuild can't resolve for a browser target (issue #6), and
 * `crypto.subtle` is the browser (and Node >=19, globally available)
 * standards-track equivalent.
 *
 * SHA-256 is SHA-256 regardless of implementation -- the two produce
 * byte-identical digests for the same input bytes, verified for real
 * against ../hash.ts in test/hash-web.test.ts (both the raw digest
 * primitive and the full artifact-hash pipeline on an identical tree) --
 * so a lock file this module produces (or reads by comparison) stays a
 * valid cache key against the Node pipeline's own output, and vice versa.
 *
 * The one structural difference from ../hash.ts: `crypto.subtle.digest()`
 * is a single one-shot call over one buffer, not `node:crypto`'s
 * incremental `.update()` API -- so content and suffix are concatenated
 * into one `Uint8Array` before digesting, rather than two separate
 * `.update()` calls. SHA-256 is a true Merkle-Damgard hash, so
 * `sha256(a + b)` and `sha256WithTwoUpdates(a, b)` are defined to produce
 * the exact same digest either way -- this is not an approximation.
 *
 * `hash()` here is `async` (`crypto.subtle.digest` is Promise-based, with
 * no synchronous alternative) -- unlike ../hash.ts's synchronous `hash()`,
 * which is left untouched for backward compatibility (it's part of this
 * package's existing, tested, individually-exported-stage public API, PRD
 * SS4). The two are not meant to be interchangeable call-for-call; each
 * belongs to its own entry point's pipeline.
 */
import type { ArtifactNode, HashedArtifact, HashResult, LayoutResult } from "../types.js";

export const HASH_ALGORITHM = "sha256";

function toHex(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let hex = "";
  for (const byte of view) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

async function digestHex(bytes: Uint8Array): Promise<string> {
  // `as BufferSource` -- TypeScript's DOM lib types `SubtleCrypto#digest`
  // against `Uint8Array<ArrayBuffer>` specifically, while a plain `new
  // Uint8Array(n)` infers the broader `Uint8Array<ArrayBufferLike>` (which
  // also covers `SharedArrayBuffer`-backed views); every buffer actually
  // constructed in this module is a real (non-shared) `ArrayBuffer`, so the
  // runtime value already satisfies `BufferSource` -- only the static type
  // needs the assist.
  const digest = await crypto.subtle.digest("SHA-256", bytes as NodeJS.BufferSource);
  return toHex(digest);
}

function concatBytes(content: string | Uint8Array | undefined, suffix: string): Uint8Array {
  const encoder = new TextEncoder();
  const suffixBytes = encoder.encode(suffix);
  if (content === undefined) return suffixBytes;
  const contentBytes = typeof content === "string" ? encoder.encode(content) : content;
  const combined = new Uint8Array(contentBytes.length + suffixBytes.length);
  combined.set(contentBytes, 0);
  combined.set(suffixBytes, contentBytes.length);
  return combined;
}

async function sha256Lines(lines: string[]): Promise<string> {
  return `${HASH_ALGORITHM}:${await digestHex(new TextEncoder().encode(lines.join("\n")))}`;
}

async function sha256WithContent(content: string | Uint8Array | undefined, suffix: string): Promise<string> {
  return `${HASH_ALGORITHM}:${await digestHex(concatBytes(content, suffix))}`;
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

/** Browser/core counterpart of ../hash.ts's `hash()` -- same algorithm, see the module doc comment for the one structural difference (async digesting). */
export async function hash(layoutResult: LayoutResult, collectionPatterns: string[] = []): Promise<HashResult> {
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
    leafHashes.set(artifact.id, await sha256WithContent(artifact.content, suffix));
  }

  const artifacts: HashedArtifact[] = [];
  for (const artifact of layoutResult.artifacts) {
    const isContainerRoot =
      (artifact.target === "zip" || artifact.target === "wbn") && artifact.containerPath === artifact.outputPath;
    let artifactHash = leafHashes.get(artifact.id)!;
    if (isContainerRoot) {
      const manifest = collectDescendants(layoutResult.byId, artifact.id)
        .map((descendant) => {
          const kind = descendant.symlinkTo !== undefined ? "symlink" : descendant.kind;
          return `${kind}\0${descendant.outputPath}\0${leafHashes.get(descendant.id) ?? ""}`;
        })
        .sort();
      artifactHash = await sha256Lines([artifactHash, ...manifest]);
    }
    artifacts.push({ ...artifact, hash: artifactHash, dependsOn: dependsOnById.get(artifact.id) ?? [] });
  }

  const byId = new Map(artifacts.map((a) => [a.id, a]));
  return { artifacts, byId, removals: layoutResult.removals, warnings: layoutResult.warnings };
}
