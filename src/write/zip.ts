/**
 * Zip writer (PRD SS5.2 `encode="zip"`): materializes a subtree as a `.zip`
 * containing the same tree, using `fflate` (pure JS, no native deps).
 *
 * The archive is built with fflate's streaming `Zip` class, which takes each
 * entry's name explicitly, not with `zipSync()`: `zipSync()` keys a plain
 * object by entry name, so an entry named `__proto__` set the prototype
 * instead of adding a key and was silently left out (#36).
 */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { strToU8, Zip, ZipDeflate, ZipPassThrough } from "fflate";
import type { HashedArtifact } from "../types.js";
import { assertSafeEntryName } from "./entry-name.js";
import { OutDirGuard } from "./contain.js";

export async function writeZips(
  artifacts: HashedArtifact[],
  outDir: string,
  dirtyRootIds: Set<string>,
  dryRun = false,
  guard: OutDirGuard = new OutDirGuard(outDir, dryRun),
): Promise<string[]> {
  const written: string[] = [];
  const zipRoots = artifacts.filter(
    (a) => a.target === "zip" && a.containerPath === a.outputPath && dirtyRootIds.has(a.id),
  );

  for (const root of zipRoots) {
    const members = artifacts.filter((a) => a.containerPath === root.containerPath && a !== root);
    for (const artifact of members) assertSafeEntryName(artifact.outputPath, "zip", root.containerPath!);
    if (!dryRun) {
      const zipped = buildZip(members.map((artifact) =>
        artifact.kind === "dir"
          ? { name: `${artifact.outputPath}/`, data: new Uint8Array(0), store: true }
          : {
              name: artifact.outputPath,
              // A Buffer (binary content -- SS2.2) is already raw bytes and a
              // Node Buffer *is* a Uint8Array, so it's used as-is; only a
              // string needs strToU8's UTF-8 encoding.
              data: typeof artifact.content === "string" ? strToU8(artifact.content) : artifact.content ?? new Uint8Array(0),
              store: false,
            },
      ));
      const fullPath = join(outDir, root.containerPath!);
      await guard.prepareReplace(fullPath);
      await writeFile(fullPath, zipped);
    }
    written.push(root.containerPath!);
  }

  return written;
}

interface ZipInput {
  name: string;
  data: Uint8Array;
  /** Stored (directory entries); everything else is deflated at fflate's default level. */
  store: boolean;
}

/**
 * Builds a zip in memory. Every entry is added by name, in order, so any
 * name (including `__proto__` and `constructor`) is kept. With the
 * synchronous `ZipDeflate`/`ZipPassThrough`, fflate calls back before each
 * `push()`/`end()` returns, so the archive is complete when this returns.
 */
export function buildZip(inputs: ZipInput[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  let failure: unknown;
  let finished = false;
  const zip = new Zip((error, chunk, final) => {
    if (error) {
      failure = error;
      return;
    }
    chunks.push(chunk);
    if (final) finished = true;
  });
  for (const input of inputs) {
    const entry = input.store ? new ZipPassThrough(input.name) : new ZipDeflate(input.name);
    zip.add(entry);
    entry.push(input.data, true);
  }
  zip.end();
  if (failure) throw failure;
  if (!finished) throw new Error("fflate's Zip did not finish synchronously");
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
