/**
 * Loose writer (PRD SS5.2 `as="loose"`): real directories/files on disk.
 * Handles the Windows symlink-permission fallback (SS5.3) at the point of
 * actually attempting `fs.symlink` -- Layout only knows the *format*-based
 * degrade (archive/inline can't hold a real symlink); this OS-level failure
 * can only be discovered here.
 */
import { access, appendFile, chmod, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { glob } from "glob";
import { combineContent } from "../content-util.js";
import { splitGlobBase, toPosixPattern } from "../glob-util.js";
import { FileableError } from "../types.js";
import type { HashedArtifact } from "../types.js";

export interface LooseWriteResult {
  written: string[];
  skipped: string[];
  warnings: string[];
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

const ON_CONFLICT_VALUES = new Set(["replace", "append", "prepend", "skip", "error"]);

/**
 * A typo (e.g. `onConflict="repalce"`) used to silently fall through to
 * unconditional overwrite -- exactly what "replace" does anyway -- so the
 * author would never learn their `"append"`/`"skip"`/etc. was never
 * applied. Now it throws instead, matching how the rest of this codebase
 * fails loudly on an unrecognized value (reserved tags, `<Dir as>`, `join`).
 */
function parseOnConflict(props: Record<string, unknown>, path: string): "replace" | "append" | "prepend" | "skip" | "error" {
  const value = props.onConflict;
  if (value === undefined) return "replace";
  if (typeof value === "string" && ON_CONFLICT_VALUES.has(value)) {
    return value as "replace" | "append" | "prepend" | "skip" | "error";
  }
  throw new FileableError(
    `invalid onConflict="${String(value)}" -- expected "replace", "append", "prepend", "skip", or "error"`,
    path,
  );
}

export async function writeLoose(
  artifacts: HashedArtifact[],
  outDir: string,
  strict: boolean,
  dryRun = false,
): Promise<LooseWriteResult> {
  const written: string[] = [];
  const skipped: string[] = [];
  const warnings: string[] = [];

  const dirs = artifacts.filter((a) => a.kind === "dir" && a.target === "loose");
  const files = artifacts.filter((a) => a.kind === "file" && a.target === "loose");

  for (const dir of dirs) {
    const fullPath = join(outDir, dir.outputPath);
    if (!dryRun) {
      await mkdir(fullPath, { recursive: true });
      if (dir.mode) await chmod(fullPath, parseInt(dir.mode, 8));
    }
    written.push(dir.outputPath);
  }

  for (const file of files) {
    const fullPath = join(outDir, file.outputPath);
    if (!dryRun) await mkdir(dirname(fullPath), { recursive: true });
    const onConflict = parseOnConflict(file.descriptor.props, file.outputPath);

    if (file.symlinkTo !== undefined) {
      // onConflict used to be silently ignored for symlinks -- a pre-existing
      // file at this path (real content, not something fileable itself put
      // there) got force-removed and replaced with the symlink regardless of
      // onConflict="error"/"skip" (confirmed by actually building this case).
      // "append"/"prepend" still don't make sense for a symlink -- there's no
      // content to append to -- so those throw whenever there's something to
      // conflict with in the first place; with nothing there yet, creating
      // the symlink normally is no different from any other onConflict mode.
      if (onConflict !== "replace" && (await pathExists(fullPath))) {
        if (onConflict === "error") {
          throw new FileableError(
            `refusing to overwrite existing file (onConflict="error"): ${file.outputPath}`,
            file.outputPath,
          );
        }
        if (onConflict === "skip") {
          skipped.push(file.outputPath);
          continue;
        }
        if (onConflict === "append" || onConflict === "prepend") {
          throw new FileableError(
            `onConflict="${onConflict}" doesn't apply to a symlink -- there's no existing content at ` +
              `${file.outputPath} to ${onConflict} to`,
            file.outputPath,
          );
        }
      }
      if (dryRun) {
        // Whether a real symlink succeeds or EPERM-falls-back-to-copy on
        // Windows can only be discovered by actually attempting it -- a
        // dry run optimistically reports "would symlink" rather than
        // pretending to know the OS's answer ahead of time.
        written.push(file.outputPath);
        continue;
      }
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
      if (onConflict !== "replace") {
        const alreadyExists = await pathExists(fullPath);
        if (alreadyExists && onConflict === "error") {
          throw new FileableError(
            `refusing to overwrite existing file (onConflict="error"): ${file.outputPath}`,
            file.outputPath,
          );
        }
        if (alreadyExists && onConflict === "skip") {
          // Leave it completely untouched -- not even mode/chmod -- for the
          // "don't overwrite a file the user may have already customized"
          // scaffolding case, which needs to continue the rest of the build
          // rather than fail it the way "error" deliberately does.
          skipped.push(file.outputPath);
          continue;
        }
        if (alreadyExists && onConflict === "append") {
          if (!dryRun) {
            await appendFile(fullPath, file.content ?? "");
            if (file.mode) await chmod(fullPath, parseInt(file.mode, 8));
          }
          written.push(file.outputPath);
          continue;
        }
        if (alreadyExists && onConflict === "prepend") {
          // append's mirror: new content goes before what's already there.
          // No native fs "prepend", so this reads the existing bytes and
          // writes new+existing back -- combineContent stays binary-safe
          // either way (SS2.2).
          if (!dryRun) {
            const existing = await readFile(fullPath);
            await writeFile(fullPath, combineContent(file.content ?? "", existing));
            if (file.mode) await chmod(fullPath, parseInt(file.mode, 8));
          }
          written.push(file.outputPath);
          continue;
        }
      }
      if (!dryRun) {
        // `writeFile`'s own `mode` option only takes effect when it
        // *creates* the file -- on a rewrite of an existing file (e.g. only
        // `mode` changed) it's silently ignored, so `mode` is always
        // applied via an explicit chmod.
        await writeFile(fullPath, file.content ?? "");
        if (file.mode) await chmod(fullPath, parseInt(file.mode, 8));
      }
    }
    written.push(file.outputPath);
  }

  return { written, skipped, warnings };
}

export async function applyRemovals(removals: string[], outDir: string, dryRun = false): Promise<string[]> {
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
      if (!dryRun) await rm(join(outDir, relative), { force: true });
      removed.push(relative);
    }
  }
  return removed;
}
