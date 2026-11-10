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
 *   it's a separate folder inside the project, and otherwise every path the
 *   previous build wrote, so a build never triggers itself. The manifest's
 *   `watch.ignore` globs (relative to the project directory) add to that.
 * - An event for a file not modified since the last build started is
 *   dropped (FSEvents on macOS can report writes from just before watching),
 *   and so is an event for a directory itself (its entries report changes).
 * - Debounced: a rebuild starts `debounceMs` after the last change. Changes
 *   during a build queue exactly one more build.
 * - A failing build (template syntax error, render error) emits `error`
 *   with fatal:false and `done` with ok:false, and watching continues; the
 *   next change retries.
 * - Uses the normal lock-file cache, so unchanged artifacts aren't
 *   rewritten. Templates and their partials are re-imported fresh each time
 *   (see loader.ts).
 */
import { existsSync, statSync, watch as fsWatch } from "node:fs";
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

export async function runWatch(config: BuildConfig, emitter: Emitter, { signal }: { signal?: AbortSignal } = {}): Promise<number> {
  const { outDir, cwd } = config.options;
  const projectDir = config.manifest?.dir ?? dirname(config.templatePath);
  const roots = [projectDir];
  if (!inside(projectDir, cwd)) roots.push(cwd);
  const lockPath = config.options.lockFile ?? join(outDir, ".fileable-lock.json");
  const outDirIsSeparate = outDir !== projectDir && !inside(outDir, projectDir);

  let lastOutputs = new Set<string>();
  const ignored = (absolute: string): boolean => {
    if (absolute.split(sep).some((s) => s === "node_modules" || s === ".git")) return true;
    if (absolute === lockPath) return true;
    if (outDirIsSeparate && inside(outDir, absolute)) return true;
    if (lastOutputs.has(absolute)) return true;
    const rel = relative(projectDir, absolute).split(sep).join("/");
    return config.watchIgnore.some((pattern) => minimatch(rel, pattern, { dot: true }));
  };

  let buildNumber = 0;
  let running = false;
  let pending = new Set<string>();
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  let idle: Promise<void> = Promise.resolve();

  // When the last build started reading sources. A change event for a
  // file whose mtime is older than this is stale (macOS FSEvents can deliver
  // writes made just before the watcher started), so it doesn't rebuild.
  let lastBuildStart = 0;
  const staleEvent = (absolute: string): boolean => {
    try {
      const info = statSync(absolute);
      // A directory's own mtime changes whenever an entry is added or removed
      // (including by our own build); the entries report themselves.
      if (info.isDirectory()) return true;
      return Math.floor(info.mtimeMs) <= lastBuildStart;
    } catch {
      return false; // deleted or unreadable: treat as a real change
    }
  };

  const runBuild = async (reason: "initial" | "change", paths: string[]) => {
    running = true;
    lastBuildStart = Date.now();
    buildNumber += 1;
    // The first build imports normally; later ones import fresh module copies.
    const generation = reason === "initial" ? 0 : nextGeneration();
    const result = await buildOnce("watch", config, emitter, { build: buildNumber, trigger: { reason, paths }, generation });
    if (result.summary) {
      const next = new Set<string>();
      for (const o of result.summary.outputs) next.add(resolvePath(outDir, o.path));
      for (const p of result.summary.removed) next.add(resolvePath(outDir, p));
      lastOutputs = next;
    }
    running = false;
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

  await (idle = runBuild("initial", []));

  const watchers: FSWatcher[] = [];
  for (const root of roots) {
    const watcher = fsWatch(root, { recursive: true }, (_event, filename) => {
      if (stopped) return;
      let absolute = filename ? resolvePath(root, filename.toString()) : root;
      // FSEvents sometimes names the watched directory itself by its basename.
      if (filename && filename.toString() === basename(root) && !existsSync(absolute)) absolute = root;
      if (ignored(absolute) || staleEvent(absolute)) return;
      pending.add(relative(projectDir, absolute).split(sep).join("/") || ".");
      schedule();
    });
    watcher.on("error", (error) => {
      emitter.warning({ code: "E_WATCH", message: `watcher error on ${root}: ${(error as Error).message}` });
    });
    watchers.push(watcher);
  }
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
