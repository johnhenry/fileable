/**
 * `.fileable-lock.json` (PRD SS8): the record of the previous build's
 * per-artifact hashes, used by Stage 5 (Write) to skip unchanged artifacts.
 */
import { readFile, writeFile } from "node:fs/promises";
import { HASH_ALGORITHM } from "./hash.js";
import type { HashedArtifact, LockFileShape } from "./types.js";

export async function readLockFile(path: string): Promise<LockFileShape | undefined> {
  try {
    const text = await readFile(path, "utf8");
    const parsed = JSON.parse(text) as LockFileShape;
    if (parsed.algorithm !== HASH_ALGORITHM) return undefined; // stale/incompatible policy -- rebuild everything
    return parsed;
  } catch {
    return undefined;
  }
}

export async function writeLockFile(path: string, artifacts: HashedArtifact[]): Promise<void> {
  const lock: LockFileShape = { version: 1, algorithm: HASH_ALGORITHM, artifacts: {} };
  for (const artifact of artifacts) {
    // Keyed by id (loose: bare outputPath; container-nested: "<containerPath>::<outputPath>"),
    // not outputPath alone -- two sibling containers can each have their own "index.html".
    lock.artifacts[artifact.id] = { hash: artifact.hash, dependsOn: artifact.dependsOn };
  }
  await writeFile(path, JSON.stringify(lock, null, 2));
}

export function isUnchanged(artifact: HashedArtifact, lock: LockFileShape | undefined): boolean {
  if (!lock) return false;
  const previous = lock.artifacts[artifact.id];
  return previous !== undefined && previous.hash === artifact.hash;
}
