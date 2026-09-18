/**
 * Loose writer (PRD SS5.2 `as="loose"`): real directories/files on disk.
 * Handles the Windows symlink-permission fallback (SS5.3) at the point of
 * actually attempting `fs.symlink` -- Layout only knows the *format*-based
 * degrade (archive/inline can't hold a real symlink); this OS-level failure
 * can only be discovered here.
 */
import { access, appendFile, chmod, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { glob } from "glob";
import { splitGlobBase, toPosixPattern } from "../glob-util.js";
import { FileableError } from "../types.js";
import type { HashedArtifact } from "../types.js";

export interface LooseWriteResult {
  written: string[];
  warnings: string[];
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function writeLoose(
  artifacts: HashedArtifact[],
  outDir: string,
  strict: boolean,
): Promise<LooseWriteResult> {
  const written: string[] = [];
  const warnings: string[] = [];

  const dirs = artifacts.filter((a) => a.kind === "dir" && a.target === "loose");
  const files = artifacts.filter((a) => a.kind === "file" && a.target === "loose");

  for (const dir of dirs) {
    const fullPath = join(outDir, dir.outputPath);
    await mkdir(fullPath, { recursive: true });
    if (dir.mode) await chmod(fullPath, parseInt(dir.mode, 8));
    written.push(dir.outputPath);
  }

  for (const file of files) {
    const fullPath = join(outDir, file.outputPath);
    await mkdir(dirname(fullPath), { recursive: true });

    if (file.symlinkTo !== undefined) {
      try {
        await rm(fullPath, { force: true });
        await symlink(file.symlinkTo, fullPath);
      } catch (error) {
        const isPermissionIssue = (error as NodeJS.ErrnoException).code === "EPERM";
        if (!isPermissionIssue) throw error;
        const message =
          `symlink to ${file.symlinkTo} was materialized as a copy because creating a real ` +
          "symlink requires elevated permissions or Developer Mode on Windows.";
        if (strict) throw new Error(message);
        warnings.push(message);
        await writeFile(fullPath, file.content ?? "");
        if (file.mode) await chmod(fullPath, parseInt(file.mode, 8));
      }
    } else {
      const onConflict = (file.descriptor.props.onConflict as "replace" | "append" | "error" | undefined) ?? "replace";
      if (onConflict !== "replace") {
        const alreadyExists = await pathExists(fullPath);
        if (alreadyExists && onConflict === "error") {
          throw new FileableError(
            `refusing to overwrite existing file (onConflict="error"): ${file.outputPath}`,
            file.outputPath,
          );
        }
        if (alreadyExists && onConflict === "append") {
          await appendFile(fullPath, file.content ?? "");
          if (file.mode) await chmod(fullPath, parseInt(file.mode, 8));
          written.push(file.outputPath);
          continue;
        }
      }
      // `writeFile`'s own `mode` option only takes effect when it *creates* the
      // file -- on a rewrite of an existing file (e.g. only `mode` changed) it's
      // silently ignored, so `mode` is always applied via an explicit chmod.
      await writeFile(fullPath, file.content ?? "");
      if (file.mode) await chmod(fullPath, parseInt(file.mode, 8));
    }
    written.push(file.outputPath);
  }

  return { written, warnings };
}

export async function applyRemovals(removals: string[], outDir: string): Promise<string[]> {
  const removed: string[] = [];
  for (const pattern of removals) {
    const posixPattern = toPosixPattern(pattern);
    const negated = posixPattern.startsWith("!");
    const raw = negated ? posixPattern.slice(1) : posixPattern;
    const { base, rest } = splitGlobBase(raw);
    const searchCwd = base ? join(outDir, base) : outDir;
    const matches = await glob(negated ? "**" : rest || raw, {
      cwd: searchCwd,
      ignore: negated ? [rest || "**"] : undefined,
      nodir: true,
      absolute: false,
    });
    for (const match of matches) {
      const relative = (base ? `${base}/${match}` : match).replace(/\\/g, "/");
      await rm(join(outDir, relative), { force: true });
      removed.push(relative);
    }
  }
  return removed;
}
