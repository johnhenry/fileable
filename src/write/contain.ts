/**
 * Keeps every write inside `outDir` (#31).
 *
 * Layout already refuses output paths that leave the tree (`E_UNSAFE_PATH`,
 * the same rule `<Dir src decode>` uses for entry names). This module covers
 * what only the disk can tell: a symlink (or Windows junction) that already
 * exists under `outDir`, from a previous build's `<File symlink>` or put
 * there by someone else. `mkdir -p`, `writeFile`, `appendFile` and `chmod`
 * all follow links, so without these checks a write to `link/file` lands
 * wherever `link` points.
 *
 * The rule: a directory fileable creates or writes into may be reached
 * through a link only if the link's real target is inside `realpath(outDir)`.
 * A file fileable replaces is never written through: an existing symlink or
 * hard link at that path is unlinked first and a new regular file is
 * created. `append`/`prepend` (which must keep the existing bytes) refuse a
 * link that leads outside `outDir`, and refuse a hard link. Only `lstat` and
 * `realpath` are used, so this works the same on POSIX and Windows.
 *
 * Not covered: another process swapping a path for a link between the check
 * and the write (a race). fileable assumes nothing else writes to `outDir`
 * while a build runs.
 */
import { chmod, lstat, mkdir, realpath, rm } from "node:fs/promises";
import type { Stats } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { FileableError } from "../types.js";

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}

/** `realpath`, but a missing tail is appended as-is to the nearest existing ancestor's real path. */
async function realpathNearest(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    const parent = dirname(path);
    if ((code !== "ENOENT" && code !== "ENOTDIR") || parent === path) throw error;
    return join(await realpathNearest(parent), basename(path));
  }
}

/** `lstat`, or `undefined` when nothing is there. */
export async function lstatIfExists(path: string): Promise<Stats | undefined> {
  try {
    return await lstat(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return undefined;
    throw error;
  }
}

export function unsafeWrite(outputPath: string, why: string): FileableError {
  return new FileableError(`unsafe output path ${JSON.stringify(outputPath)} -- ${why}; fileable never writes outside outDir`, outputPath, undefined, "E_UNSAFE_PATH");
}

export class OutDirGuard {
  /** `outDir`, absolute. */
  readonly root: string;
  private realRoot: Promise<string> | undefined;
  private readonly ensured = new Map<string, Promise<void>>();

  constructor(outDir: string, private readonly dryRun = false) {
    this.root = resolve(outDir);
  }

  private realRootPath(): Promise<string> {
    this.realRoot ??= realpathNearest(this.root);
    return this.realRoot;
  }

  /** `outputPath` relative to outDir, for messages. */
  private display(fullPath: string): string {
    return relative(this.root, fullPath).split(sep).join("/") || ".";
  }

  /** Throws `E_UNSAFE_PATH` unless the symlink at `fullPath` resolves to somewhere inside outDir. */
  async assertLinkInside(fullPath: string): Promise<void> {
    let target: string;
    try {
      target = await realpath(fullPath);
    } catch {
      throw unsafeWrite(this.display(fullPath), "it goes through a symlink whose target doesn't exist");
    }
    if (!isInside(await this.realRootPath(), target)) {
      throw unsafeWrite(this.display(fullPath), `it goes through a symlink that leads outside outDir (to ${target})`);
    }
  }

  /** Throws `E_UNSAFE_PATH` if `fullPath` is not under outDir at all (layout should make this impossible). */
  private assertUnderRoot(fullPath: string): void {
    if (!isInside(this.root, fullPath)) throw unsafeWrite(this.display(fullPath), "it resolves outside outDir");
  }

  /**
   * Creates `path` (and its parents, each once), checking each level that
   * already exists: a link is followed only if it stays inside outDir. In a
   * dry run the checks run and nothing is created.
   */
  ensureDir(path: string, mode?: string): Promise<void> {
    const full = resolve(path);
    const existing = this.ensured.get(full);
    if (existing && mode === undefined) return existing;
    const isRoot = full === this.root;
    if (!isRoot) this.assertUnderRoot(full);
    const created = (async () => {
      if (existing) await existing;
      else if (!isRoot) await this.ensureDir(dirname(full));
      if (!isRoot) {
        const info = await lstatIfExists(full);
        if (info?.isSymbolicLink()) await this.assertLinkInside(full);
      }
      if (this.dryRun) return;
      await mkdir(full, { recursive: true });
      if (mode) await chmod(full, parseInt(mode, 8));
    })();
    this.ensured.set(full, created);
    return created;
  }

  /**
   * Prepares `fullPath` for a write that replaces it: its parent directory is
   * checked and created, and an existing symlink or hard link there is
   * removed so the write creates a new regular file instead of writing
   * through the link.
   */
  async prepareReplace(fullPath: string): Promise<void> {
    this.assertUnderRoot(fullPath);
    await this.ensureDir(dirname(fullPath));
    const info = await lstatIfExists(fullPath);
    if (info && (info.isSymbolicLink() || (info.isFile() && info.nlink > 1)) && !this.dryRun) {
      await rm(fullPath, { force: true });
    }
  }

  /**
   * For a write that keeps the existing bytes (`append`/`prepend`): refuses a
   * symlink that leads outside outDir, and a hard link (the other name could
   * be anywhere).
   */
  async assertAppendable(fullPath: string, info: Stats): Promise<void> {
    if (info.isSymbolicLink()) await this.assertLinkInside(fullPath);
    else if (info.isFile() && info.nlink > 1) {
      throw unsafeWrite(this.display(fullPath), "it is a hard link, so appending to it would change the file under its other names too");
    }
  }

  /** For removals: the parent directory of `fullPath` must really be inside outDir. */
  async assertParentInside(fullPath: string): Promise<void> {
    this.assertUnderRoot(fullPath);
    let parent: string;
    try {
      parent = await realpath(dirname(fullPath));
    } catch {
      return; // gone already: nothing to remove
    }
    if (!isInside(await this.realRootPath(), parent)) {
      throw unsafeWrite(this.display(fullPath), `removing it would go through a symlink that leads outside outDir (to ${parent})`);
    }
  }
}
