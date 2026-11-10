/**
 * `fileable watch` (#25): build once, then rebuild whenever a file under the
 * project changes. Same events as `build`, one start..done pair per build,
 * plus `watching` (after the first build), `reloading` {files} (a change;
 * exactly one build, ending in one `done`, follows), and `stopping` {signal}
 * on SIGINT/SIGTERM. main() then emits `stopped` {exitCode} as the last line.
 *
 * - Watches the template's directory (or the manifest's project directory)
 *   and `cwd` when that's outside it, recursively (`fs.watch`, recursive on
 *   macOS, Windows and Linux in Node >= 20).
 * - Ignores node_modules, .git, the lock file, the output directory when
 *   it's a separate folder inside the project, and otherwise every path a
 *   build in this session wrote or removed, so a build never triggers
 *   itself (a file an earlier build wrote stays ignored even once a later
 *   build stops writing it). The manifest's
 *   `watch.ignore` globs (relative to the project directory) add to that.
 * - Change detection is by content, not by clock (#44). Before the first
 *   build reads anything, every watched file's size and SHA-256 are
 *   recorded; an event rebuilds only if the file's content (or existence)
 *   differs from what was last recorded for it, and accepting it records
 *   the new content. So a replayed event (FSEvents on macOS can report
 *   writes from just before watching) or a duplicate event for one write
 *   doesn't rebuild, while every real edit does, whatever its mtime --
 *   including edits made while a build runs, the initial one included.
 *   An event for a directory itself is dropped (its entries report changes).
 * - Events that arrive while a build runs are held until it finishes and
 *   then checked against the paths it wrote, so the build's own output never
 *   triggers a rebuild even for a path it wrote for the first time.
 * - Debounced: a rebuild starts `debounceMs` after the last change. Changes
 *   during a build queue exactly one more build.
 * - A failing build (template syntax error, render error) emits `error`
 *   with fatal:false and `done` with ok:false, and watching continues; the
 *   next change retries.
 * - Uses the normal lock-file cache, so unchanged artifacts aren't
 *   rewritten. Templates and their partials are re-imported fresh each time
 *   (see loader.ts).
 */
import { createHash } from "node:crypto";
import { closeSync, existsSync, openSync, readdirSync, readSync, statSync, watch as fsWatch } from "node:fs";
import type { FSWatcher } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve as resolvePath, sep } from "node:path";
import { minimatch } from "minimatch";
import { buildOnce } from "./fileable.js";
import type { BuildConfig } from "./fileable.js";
import type { Emitter } from "./events.js";
import { nextGeneration } from "./loader.js";
import { EXIT_OK } from "../src/errors.js";

function inside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** What a watched path holds: a directory, or a file's size and SHA-256. */
type Fingerprint = { dir: true } | { dir: false; size: number; hash: string };

const CHUNK = 1 << 20;

/** undefined when the path doesn't exist or can't be read. */
export function fingerprint(absolute: string): Fingerprint | undefined {
  let fd: number | undefined;
  try {
    const info = statSync(absolute);
    if (info.isDirectory()) return { dir: true };
    fd = openSync(absolute, "r");
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(CHUNK);
    let size = 0;
    for (let n: number; (n = readSync(fd, buffer, 0, CHUNK, null)) > 0; size += n) hash.update(buffer.subarray(0, n));
    return { dir: false, size, hash: hash.digest("hex") };
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export async function runWatch(config: BuildConfig, emitter: Emitter, { signal }: { signal?: AbortSignal } = {}): Promise<number> {
  const { outDir, cwd } = config.options;
  const projectDir = config.manifest?.dir ?? dirname(config.templatePath);
  const roots = [projectDir];
  if (!inside(projectDir, cwd)) roots.push(cwd);
  const lockPath = config.options.lockFile ?? join(outDir, ".fileable-lock.json");
  const outDirIsSeparate = outDir !== projectDir && !inside(outDir, projectDir);

  // Every path a build in this session wrote or removed. Cumulative: an
  // event for a file an earlier build wrote can arrive after a later build
  // that no longer writes it (FSEvents delivers late), and it is still ours.
  const outputs = new Set<string>();
  const ignored = (absolute: string): boolean => {
    if (absolute.split(sep).some((s) => s === "node_modules" || s === ".git")) return true;
    if (absolute === lockPath) return true;
    if (outDirIsSeparate && inside(outDir, absolute)) return true;
    if (outputs.has(absolute)) return true;
    const rel = relative(projectDir, absolute).split(sep).join("/");
    return config.watchIgnore.some((pattern) => minimatch(rel, pattern, { dot: true }));
  };

  let buildNumber = 0;
  let running = false;
  let pending = new Set<string>();
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  let idle: Promise<void> = Promise.resolve();

  // The content each watched file had when it was last recorded: before the
  // first build, or when an event for it was accepted. Every recorded state
  // has a build that started reading after it was recorded, so an event
  // whose file still matches its record has nothing new to build (#44).
  const known = new Map<string, string>();
  const record = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const absolute = join(dir, entry.name);
      if (ignored(absolute)) continue;
      if (entry.isDirectory()) record(absolute);
      else if (entry.isFile() || entry.isSymbolicLink()) {
        const print = fingerprint(absolute);
        if (print && !print.dir) known.set(absolute, `${print.size}:${print.hash}`);
      }
    }
  };
  /** Whether an event for this path is a real change; records it if so. */
  const changed = (absolute: string): boolean => {
    if (ignored(absolute)) return false;
    const print = fingerprint(absolute);
    // A directory's own events (an entry added or removed, including by our
    // own build) are covered by its entries' events.
    if (print?.dir) return false;
    const before = known.get(absolute);
    if (print === undefined) {
      // Gone (or unreadable): a change only if it was there before.
      if (before === undefined) return false;
      known.delete(absolute);
      return true;
    }
    const now = `${print.size}:${print.hash}`;
    if (before === now) return false;
    known.set(absolute, now);
    return true;
  };
  // Raw events seen while a build runs, judged once it has finished and
  // `outputs` names everything it wrote.
  let held = new Set<string>();
  const accept = (absolute: string) => {
    if (!changed(absolute)) return;
    pending.add(relative(projectDir, absolute).split(sep).join("/") || ".");
  };

  const runBuild = async (reason: "initial" | "change", paths: string[]) => {
    running = true;
    buildNumber += 1;
    // The first build imports normally; later ones import fresh module copies.
    const generation = reason === "initial" ? 0 : nextGeneration();
    const result = await buildOnce("watch", config, emitter, { build: buildNumber, trigger: { reason, paths }, generation });
    if (result.summary) {
      for (const o of result.summary.outputs) outputs.add(resolvePath(outDir, o.path));
      for (const p of result.summary.removed) outputs.add(resolvePath(outDir, p));
    }
    running = false;
    const seen = held;
    held = new Set();
    for (const absolute of seen) accept(absolute);
    if (pending.size > 0 && !stopped) schedule();
  };

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      if (running || stopped) return;
      const paths = [...pending].sort();
      pending = new Set();
      emitter.emit({ event: "reloading", files: paths });
      emitter.say(`fileable: change: ${paths.join(", ") || "(unknown file)"}`);
      idle = runBuild("change", paths);
    }, config.debounceMs);
  };

  // Watch first, then record, then build: an edit at any point after the
  // record is taken is seen (held until the first build is done), and the
  // first build reads nothing older than the record.
  running = true;
  const watchers: FSWatcher[] = [];
  for (const root of roots) {
    const watcher = fsWatch(root, { recursive: true }, (_event, filename) => {
      if (stopped) return;
      let absolute = filename ? resolvePath(root, filename.toString()) : root;
      // FSEvents sometimes names the watched directory itself by its basename.
      if (filename && filename.toString() === basename(root) && !existsSync(absolute)) absolute = root;
      if (running) {
        held.add(absolute);
        return;
      }
      accept(absolute);
      if (pending.size > 0) schedule();
    });
    watcher.on("error", (error) => {
      emitter.warning({ code: "E_WATCH", message: `watcher error on ${root}: ${(error as Error).message}` });
    });
    watchers.push(watcher);
  }
  for (const root of roots) record(root);
  await (idle = runBuild("initial", []));

  emitter.emit({ event: "watching", paths: roots });
  emitter.say(`fileable: watching ${roots.join(", ")} (Ctrl-C to stop)`);

  await new Promise<void>((resolveStop) => {
    const stop = (signalName: string) => {
      if (stopped) return;
      stopped = true;
      emitter.emit({ event: "stopping", signal: signalName });
      if (timer) clearTimeout(timer);
      for (const w of watchers) w.close();
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
      signal?.removeEventListener("abort", onAbort);
      resolveStop();
    };
    const onSigint = () => stop("SIGINT");
    const onSigterm = () => stop("SIGTERM");
    const onAbort = () => stop("abort");
    process.on("SIGINT", onSigint);
    process.on("SIGTERM", onSigterm);
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort);
  });
  // A build already running finishes (and reports its done) before we stop.
  await idle;
  emitter.say("fileable: stopped watching");
  return EXIT_OK;
}
