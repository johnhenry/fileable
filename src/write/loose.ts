/**
 * Loose writer (PRD SS5.2 `encode="loose"`): real directories/files on disk.
 * Handles the Windows symlink-permission fallback (SS5.3) at the point of
 * actually attempting `fs.symlink` -- Layout only knows the *format*-based
 * degrade (archive/inline can't hold a real symlink); this OS-level failure
 * can only be discovered here.
 */
import { access, appendFile, chmod, lstat, readFile, readdir, rm, rmdir, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { glob } from "glob";
import { combineContent } from "../content-util.js";
import { lstatIfExists, OutDirGuard } from "./contain.js";
import { splitGlobBase, toPosixPattern } from "../glob-util.js";
import { FileableError } from "../types.js";
import { IO_CONCURRENCY, mapLimit } from "../concurrency.js";
import type { DeletableFileInfo, HashedArtifact, RemovalSpec } from "../types.js";

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
    path, undefined, "E_INVALID_PROP",
  );
}

type FileOutcome = { status: "written" | "skipped"; warning?: string };
const WRITTEN: FileOutcome = { status: "written" };
const SKIPPED: FileOutcome = { status: "skipped" };

/**
 * Stage 5 for `encode="loose"`. Directories first (in tree order, parents
 * before children), then files, each phase with up to IO_CONCURRENCY
 * operations in flight (issue #22) -- previously every file awaited its own
 * `mkdir -p` and write one at a time.
 *
 * Observable result is the same as the sequential version: `written` /
 * `skipped` / `warnings` are in artifact order, and each distinct parent
 * directory is created once (still before anything inside it). On failure
 * no further files are started, in-flight ones are allowed to finish, and
 * the error thrown is that of the first failing artifact in artifact order
 * -- the one the sequential loop would have thrown. The difference is that
 * up to IO_CONCURRENCY - 1 artifacts *after* it may also have been written
 * by then (the sequential loop stopped exactly at it); a failed build was
 * never transactional either way.
 */
export async function writeLoose(
  artifacts: HashedArtifact[],
  outDir: string,
  strict: boolean,
  dryRun = false,
  guard: OutDirGuard = new OutDirGuard(outDir, dryRun),
): Promise<LooseWriteResult> {
  const dirs = artifacts.filter((a) => a.kind === "dir" && a.target === "loose");
  const files = artifacts.filter((a) => a.kind === "file" && a.target === "loose");

  // One promise per distinct directory (OutDirGuard.ensureDir): created once,
  // and only after its parent's promise (including a parent <Dir mode>
  // chmod) has settled. Tasks start in artifact (tree pre-)order and
  // register synchronously, so a <Dir>'s own task is always the one its
  // children find. Every level that already exists is checked for a symlink
  // leading outside outDir (#31) -- in a dry run too, so a dry run reports
  // the same E_UNSAFE_PATH a real run would.
  await mapLimit(dirs, IO_CONCURRENCY, (dir) => guard.ensureDir(join(outDir, dir.outputPath), dir.mode ?? ""));
  const written: string[] = dirs.map((d) => d.outputPath);

  // No two files here can be one file on disk: layout refuses paths that
  // differ only in case or Unicode normalization (E_PATH_CONFLICT, #31), so
  // files are written independently.
  const outcomes = await mapLimit(files, IO_CONCURRENCY, async (file) => {
    const fullPath = join(outDir, file.outputPath);
    await guard.ensureDir(dirname(fullPath));
    return writeOneFile(file, fullPath, strict, dryRun, guard);
  });

  const skipped: string[] = [];
  const warnings: string[] = [];
  outcomes.forEach((outcome, i) => {
    if (outcome.warning !== undefined) warnings.push(outcome.warning);
    (outcome.status === "written" ? written : skipped).push(files[i].outputPath);
  });
  return { written, skipped, warnings };
}

async function writeOneFile(
  file: HashedArtifact,
  fullPath: string,
  strict: boolean,
  dryRun: boolean,
  guard: OutDirGuard,
): Promise<FileOutcome> {
  let warning: string | undefined;
  const onConflict = parseOnConflict(file.descriptor.props, file.outputPath);
  // lstat, not access(): access() follows a symlink, so a dangling link
  // looked like "nothing here" and a link to a file outside outDir looked
  // like a file inside it (#31).
  const existing = await lstatIfExists(fullPath);

  if (file.symlinkTo !== undefined) {
    // onConflict used to be silently ignored for symlinks -- a pre-existing
    // file at this path (real content, not something fileable itself put
    // there) got force-removed and replaced with the symlink regardless of
    // onConflict="error"/"skip" (confirmed by actually building this case).
    // "append"/"prepend" still don't make sense for a symlink -- there's no
    // content to append to -- so those throw whenever there's something to
    // conflict with in the first place; with nothing there yet, creating
    // the symlink normally is no different from any other onConflict mode.
    if (onConflict !== "replace" && existing !== undefined) {
      if (onConflict === "error") {
        throw new FileableError(
          `refusing to overwrite existing file (onConflict="error"): ${file.outputPath}`,
          file.outputPath, undefined, "E_CONFLICT",
        );
      }
      if (onConflict === "skip") {
        return SKIPPED;
      }
      if (onConflict === "append" || onConflict === "prepend") {
        throw new FileableError(
          `onConflict="${onConflict}" doesn't apply to a symlink -- there's no existing content at ` +
            `${file.outputPath} to ${onConflict} to`,
          file.outputPath, undefined, "E_CONFLICT",
        );
      }
    }
    if (dryRun) {
      // Whether a real symlink succeeds or EPERM-falls-back-to-copy on
      // Windows can only be discovered by actually attempting it -- a
      // dry run optimistically reports "would symlink" rather than
      // pretending to know the OS's answer ahead of time.
      return WRITTEN;
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
      if (strict) throw new FileableError(message, file.outputPath, undefined, "E_SYMLINK");
      warning = message;
      await writeFile(fullPath, file.content ?? "");
      if (file.mode) await chmod(fullPath, parseInt(file.mode, 8));
    }
  } else {
    if (onConflict !== "replace") {
      const alreadyExists = existing !== undefined;
      if (existing !== undefined && (onConflict === "append" || onConflict === "prepend")) {
        await guard.assertAppendable(fullPath, existing);
      }
      if (alreadyExists && onConflict === "error") {
        throw new FileableError(
          `refusing to overwrite existing file (onConflict="error"): ${file.outputPath}`,
          file.outputPath, undefined, "E_CONFLICT",
        );
      }
      if (alreadyExists && onConflict === "skip") {
        // Leave it completely untouched -- not even mode/chmod -- for the
        // "don't overwrite a file the user may have already customized"
        // scaffolding case, which needs to continue the rest of the build
        // rather than fail it the way "error" deliberately does.
        return SKIPPED;
      }
      if (alreadyExists && onConflict === "append") {
        if (!dryRun) {
          await appendFile(fullPath, file.content ?? "");
          if (file.mode) await chmod(fullPath, parseInt(file.mode, 8));
        }
        return WRITTEN;
      }
      if (alreadyExists && onConflict === "prepend") {
        // append's mirror: new content goes before what's already there.
        // No native fs "prepend", so this reads the existing bytes and
        // writes new+existing back -- combineContent stays binary-safe
        // either way (SS2.2).
        if (!dryRun) {
          const previous = await readFile(fullPath);
          await writeFile(fullPath, combineContent(file.content ?? "", previous));
          if (file.mode) await chmod(fullPath, parseInt(file.mode, 8));
        }
        return WRITTEN;
      }
    }
    // A symlink or hard link already at this path is replaced, not written
    // through: writeFile would otherwise change whatever it points at (#31).
    await guard.prepareReplace(fullPath);
    if (!dryRun) {
      // `writeFile`'s own `mode` option only takes effect when it
      // *creates* the file -- on a rewrite of an existing file (e.g. only
      // `mode` changed) it's silently ignored, so `mode` is always
      // applied via an explicit chmod.
      await writeFile(fullPath, file.content ?? "");
      if (file.mode) await chmod(fullPath, parseInt(file.mode, 8));
    }
  }
  return warning === undefined ? WRITTEN : { status: "written", warning };
}

export interface RemovalResult {
  removed: string[];
  warnings: string[];
}

/**
 * Deliberately still one match at a time (issue #22 looked at it): each
 * match's lstat must see the effect of earlier removals (a removed parent
 * makes its children vanish, and they must not be reported as removed), and
 * `deletable()` is user code whose call order and non-overlap are
 * observable. It also only runs for builds that use <Rm>.
 */
export async function applyRemovals(
  removals: RemovalSpec[],
  outDir: string,
  dryRun = false,
  guard: OutDirGuard = new OutDirGuard(outDir, dryRun),
): Promise<RemovalResult> {
  const removed: string[] = [];
  const warnings: string[] = [];

  for (const spec of removals) {
    const posixPattern = toPosixPattern(spec.pattern);
    const negated = posixPattern.startsWith("!");
    const raw = negated ? posixPattern.slice(1) : posixPattern;
    const { base, rest } = splitGlobBase(raw);
    const searchCwd = base ? join(outDir, base) : outDir;
    // nodir stays hardcoded true for kind: "file" (today's only behavior,
    // unchanged); "dir"/"any" need glob to actually return directory
    // matches, filtered precisely by stat() below (glob's own `nodir`
    // only ever means "exclude directories", never "directories only").
    const matches = await glob(negated ? "**" : rest || raw, {
      cwd: searchCwd,
      ignore: negated ? [rest || "**"] : undefined,
      nodir: spec.kind === "file",
      absolute: false,
    });

    let removedForThisTarget = 0;

    for (const match of matches) {
      // A `kind: "dir" | "any"` pattern that (like the negated case always
      // has) expands to "**" can match "." -- the search root itself, real
      // and confirmed by actually running glob("**") over a real directory,
      // not assumed. Harmless before this feature existed (glob's own
      // `nodir: true` was hardcoded, and a directory -- "." included --
      // could never match), but `kind: "dir"`'s recursive removal makes
      // this a real "delete everything this <Rm> was scoped under" footgun
      // now. Never a legitimate removal target -- skipped unconditionally,
      // not subject to kind/emptyOnly/deletable at all.
      if (match === "." || match === "") continue;
      const relative = (base ? `${base}/${match}` : match).replace(/\\/g, "/");
      const fullPath = join(outDir, relative);
      // A pattern like "link/*" makes glob walk through `link`; if that is a
      // symlink leading outside outDir, its matches are not ours to remove
      // (#31). The matched path itself, if a link, is removed as a link.
      await guard.assertParentInside(fullPath);

      // lstat, not stat -- same reason resolve.ts's own <Dir from> glob
      // matching uses the dirent's own (unfollowed) type rather than a
      // followed one (see resolve.ts's `resolveFromGlob` comment): a
      // symlink *pointing at* a directory shouldn't be classified as one
      // itself, or kind/emptyOnly would be deciding based on what the
      // symlink resolves to rather than the matched path itself. Stat'd
      // regardless of dryRun -- kind/emptyOnly/deletable all need real
      // file info to decide anything, even just to *report* what would
      // happen. `null` (not thrown) on failure: the target existed a
      // moment ago when glob() found it, but is already gone by the time
      // we get here -- almost always because an earlier match in this same
      // <Rm> removed a parent directory this path was inside, not an error
      // condition worth stopping the whole build over.
      let stats: Awaited<ReturnType<typeof lstat>> | null;
      try {
        stats = await lstat(fullPath);
      } catch {
        stats = null;
      }

      if (stats !== null) {
        if (spec.kind === "dir" && !stats.isDirectory()) continue;
        if (stats.isDirectory() && spec.emptyOnly) {
          const entries = await readdir(fullPath);
          if (entries.length > 0) continue; // not empty -- doesn't qualify, silently excluded like any other non-match
        }
      }

      if (spec.deletable) {
        const fileInfo: DeletableFileInfo | null =
          stats === null
            ? null
            : { size: stats.size, isDirectory: stats.isDirectory(), isFile: stats.isFile(), mtime: stats.mtime };
        let ok: boolean;
        try {
          ok = await spec.deletable(fileInfo, { path: relative, pattern: spec.pattern });
        } catch (cause) {
          throw new FileableError(`deletable() threw for "${relative}"`, relative, cause, "E_RM");
        }
        if (!ok) continue;
      }

      if (stats === null) continue; // nothing to actually remove, whatever deletable said

      if (!dryRun) {
        if (stats.isDirectory() && spec.emptyOnly) {
          // `fs.rm(path, {recursive: false})` refuses ANY directory
          // outright (EISDIR), empty or not -- confirmed directly, not
          // assumed; it is not an "only if empty" mode. `fs.rmdir()` is
          // the real one: succeeds on an empty directory, throws
          // `ENOTEMPTY` on a non-empty one -- the hard backstop if the
          // `readdir()` emptiness check above raced with something else
          // writing into the directory in between.
          await rmdir(fullPath);
        } else {
          // A directory match without emptyOnly is a real, deliberate
          // recursive delete; a file (or a symlink, which `isDirectory()`
          // -- lstat-based -- correctly reports false for) never needs it.
          await rm(fullPath, { recursive: stats.isDirectory(), force: true });
        }
      }
      removed.push(relative);
      removedForThisTarget++;
    }

    if (removedForThisTarget === 0 && spec.onMissing !== "ignore") {
      const message = `<Rm target="${spec.pattern}"> matched nothing to remove`;
      if (spec.onMissing === "error") {
        throw new FileableError(message, spec.pattern, undefined, "E_RM");
      }
      warnings.push(message);
    }
  }

  return { removed, warnings };
}
