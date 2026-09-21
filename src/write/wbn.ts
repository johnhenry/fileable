/**
 * Wbn writer (`encode="wbn"`): materializes a subtree as a single `.wbn` file --
 * gzip(`application/webbundle`), the format Chrome's Isolated Web Apps (and
 * `@johnhenry/packfile`'s own archive format) are built on -- via the real,
 * Google-maintained `wbn` package directly, no `@johnhenry/packfile`
 * dependency at all. `@johnhenry/packfile`'s own archive format IS this
 * format (a `wbn.BundleBuilder` bundle, gzip-wrapped, resolved against a
 * fixed internal base URL -- see its `lib/to-archive.mjs`), so producing the
 * same bytes here needs only the same underlying library, not an
 * intermediate package -- and `@johnhenry/packfile` isn't published to npm,
 * so depending on it directly would mean `npm install @johnhenry/fileable`
 * doesn't resolve for anyone outside a matching monorepo checkout. See
 * `wbn-constants.ts` for `ARCHIVE_BASE_URL` -- shared with resolve.ts's
 * decode side (`<Dir src decode="wbn">`), the inverse of this writer.
 *
 * Unlike a `.zip` (write/zip.ts), a Web Bundle has no directory-entry
 * concept at all -- only files are represented (`wbn.BundleBuilder` has no
 * "directory exchange" of any kind). An empty `<Dir>` inside a `"wbn"` root
 * simply contributes no entry.
 */
import { gzip } from "node:zlib";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import * as wbn from "wbn";
import type { HashedArtifact } from "../types.js";
import { getContentType } from "../mime.js";
import { ARCHIVE_BASE_URL } from "../wbn-constants.js";

const gzipAsync = promisify(gzip);

export async function writeWbn(
  artifacts: HashedArtifact[],
  outDir: string,
  dirtyRootIds: Set<string>,
  dryRun = false,
): Promise<string[]> {
  const written: string[] = [];
  const wbnRoots = artifacts.filter(
    (a) => a.target === "wbn" && a.containerPath === a.outputPath && dirtyRootIds.has(a.id),
  );

  for (const root of wbnRoots) {
    if (!dryRun) {
      const builder = new wbn.BundleBuilder();
      for (const artifact of artifacts) {
        if (artifact.containerPath !== root.containerPath || artifact === root || artifact.kind !== "file") continue;
        const data: Uint8Array =
          typeof artifact.content === "string" ? Buffer.from(artifact.content, "utf8") : (artifact.content ?? Buffer.alloc(0));
        const url = new URL(artifact.outputPath, ARCHIVE_BASE_URL).toString();
        builder.addExchange(url, 200, { "Content-Type": getContentType(artifact.outputPath) }, data);
      }
      builder.setPrimaryURL(ARCHIVE_BASE_URL);

      const packed = await gzipAsync(Buffer.from(builder.createBundle()));
      const fullPath = join(outDir, root.containerPath!);
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, packed);
    }
    written.push(root.containerPath!);
  }

  return written;
}
