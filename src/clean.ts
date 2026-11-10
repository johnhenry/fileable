/**
 * `fileable clean`'s removal half (#34). The lock file sits in the output
 * directory, so anything that can write there (a checked-in or downloaded
 * build output) controls which ids it lists. Every id is therefore treated
 * as untrusted, with the same rule a build applies to the paths it writes
 * (#31):
 *
 * - After normalizing, the id must pass `unsafeArchivePathReason()`: no
 *   `..` climbing out, no absolute path or drive letter, no backslash,
 *   control character, or empty, `.` or dots-and-spaces segment.
 * - On disk, its parent directory's real path must be inside
 *   `realpath(dir)`, so a symlink or junction in `dir` that leads outside it
 *   is never walked through (`OutDirGuard.assertParentInside()`).
 *
 * Every id is checked before anything is removed: one unsafe id means
 * `E_UNSAFE_PATH` and nothing is deleted. A path that is itself a symlink
 * or junction is removed as a link (its target is left alone); a real
 * directory is removed recursively, and `rm` never follows the links inside
 * it.
 */
import { rm, rmdir, unlink } from "node:fs/promises";
import { join, posix } from "node:path";
import { unsafeArchivePathReason } from "./archive-path.js";
import { OutDirGuard, lstatIfExists, unsafeWrite } from "./write/contain.js";

/**
 * Checks every lock id against `dir` and returns their normalized relative
 * paths, in order. Throws `E_UNSAFE_PATH` for the first unsafe id.
 */
export async function checkCleanPaths(dir: string, ids: string[]): Promise<string[]> {
  const guard = new OutDirGuard(dir, true);
  const paths: string[] = [];
  for (const id of ids) {
    const normalized = posix.normalize(id);
    const reason = unsafeArchivePathReason(normalized);
    if (reason !== undefined) {
      throw unsafeWrite(id, `the lock file lists a path that is not a safe relative path (${reason})`);
    }
    await guard.assertParentInside(join(guard.root, normalized));
    paths.push(normalized);
  }
  return paths;
}

/** Removes one checked path: a link as a link, a directory recursively, anything else as a file. */
export async function removeCleanPath(dir: string, relative: string): Promise<void> {
  const full = join(dir, relative);
  const info = await lstatIfExists(full);
  if (!info) return;
  if (info.isSymbolicLink()) {
    try {
      await unlink(full);
    } catch (error) {
      // A Windows junction or directory symlink is removed with rmdir,
      // which removes the link and never its target.
      if ((error as NodeJS.ErrnoException).code !== "EPERM" && (error as NodeJS.ErrnoException).code !== "EISDIR") throw error;
      await rmdir(full);
    }
    return;
  }
  await rm(full, { recursive: info.isDirectory(), force: true });
}
