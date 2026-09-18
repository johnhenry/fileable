/**
 * Loose writer (PRD SS5.2 `as="loose"`): real directories/files on disk.
 * Handles the Windows symlink-permission fallback (SS5.3) at the point of
 * actually attempting `fs.symlink` -- Layout only knows the *format*-based
 * degrade (archive/inline can't hold a real symlink); this OS-level failure
 * can only be discovered here.
 */
import { chmod, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { glob } from "glob";
import type { HashedArtifact } from "../types.js";

export interface LooseWriteResult {
  written: string[];
  warnings: string[];
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
        await writeFile(fullPath, file.content ?? "", { mode: file.mode ? parseInt(file.mode, 8) : undefined });
      }
    } else {
      await writeFile(fullPath, file.content ?? "", { mode: file.mode ? parseInt(file.mode, 8) : undefined });
    }
    written.push(file.outputPath);
  }

  return { written, warnings };
}

export async function applyRemovals(removals: string[], outDir: string): Promise<string[]> {
  const removed: string[] = [];
  for (const pattern of removals) {
    const negated = pattern.startsWith("!");
    const matches = await glob(negated ? "**" : pattern, {
      cwd: outDir,
      ignore: negated ? [pattern.slice(1)] : undefined,
      nodir: true,
      absolute: false,
    });
    for (const match of matches) {
      await rm(join(outDir, match), { force: true });
      removed.push(match);
    }
  }
  return removed;
}
