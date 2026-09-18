/**
 * `.fileable-lock.json` (PRD SS8): the record of the previous build's
 * per-artifact hashes, used by Stage 5 (Write) to skip unchanged artifacts.
 */
import { readFile, writeFile } from "node:fs/promises";
import type { HashedArtifact, LockFileShape } from "./types.js";

export async function readLockFile(path: string): Promise<LockFileShape | undefined> {
  try {
    const text = await readFile(path, "utf8");
    return JSON.parse(text) as LockFileShape;
  } catch {
    return undefined;
  }
}

export async function writeLockFile(path: string, artifacts: HashedArtifact[]): Promise<void> {
  const lock: LockFileShape = { version: 1, artifacts: {} };
  for (const artifact of artifacts) {
    lock.artifacts[artifact.outputPath] = { hash: artifact.hash, dependsOn: artifact.dependsOn };
  }
  await writeFile(path, JSON.stringify(lock, null, 2));
}

export function isUnchanged(artifact: HashedArtifact, lock: LockFileShape | undefined): boolean {
  if (!lock) return false;
  const previous = lock.artifacts[artifact.outputPath];
  return previous !== undefined && previous.hash === artifact.hash;
}
