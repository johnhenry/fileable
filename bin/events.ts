/**
 * The CLI's two output modes (#25): human-readable text (the default) and
 * `--json`, one JSON object per line (NDJSON) on stdout. Every line has the
 * envelope `{"v":1,"event":<name>,"time":<ISO-8601>, ...fields}` shared
 * with `@johnhenry/servable` and `@johnhenry/hostable`, and the shared
 * events (`warning`, `error`, `reloading`, `stopping`, `stopped`) have the
 * same fields there. `v` (EVENTS_SCHEMA_VERSION) only changes when a field
 * is removed or retyped; new events and new fields don't change it.
 * Documented in docs/events.md and the README ("Machine interface").
 */
import type { ErrorDescription } from "../src/errors.js";
import type { FileableWarning, OutputEntry, RenderTarget } from "../src/types.js";

export const EVENTS_SCHEMA_VERSION = 1;

export type Command = "build" | "clean" | "eject" | "watch" | "manifest" | "version";

export interface Counts {
  written: number;
  unchanged: number;
  skipped: number;
  removed: number;
  warnings: number;
}

export interface OutputShape {
  outDir: string;
  /** "loose" | "zip" | "wbn" when every root has that encode; "mixed" otherwise; "empty" with no roots. */
  shape: RenderTarget | "mixed" | "empty";
  roots: Array<{ path: string; kind: "file" | "dir"; encode: RenderTarget; hash: string }>;
}

export type FileableEvent =
  | {
      event: "start";
      command: Command;
      build?: number;
      trigger?: { reason: "initial" | "change"; paths: string[] };
      template?: string;
      manifest?: string;
      outDir?: string;
      cwd?: string;
      dryRun: boolean;
      cache?: boolean;
      fileable: string;
      node: string;
    }
  | {
      event: "file";
      path: string;
      action: "written" | "unchanged" | "skipped" | "removed";
      kind?: "file" | "dir";
      encode?: RenderTarget;
      hash?: string;
      root?: boolean;
    }
  | ({ event: "warning" } & FileableWarning)
  | ({ event: "error" } & ErrorDescription)
  | {
      event: "done";
      command: Command;
      ok: boolean;
      exitCode: number;
      durationMs: number;
      build?: number;
      dryRun?: boolean;
      counts: Counts;
      buildHash?: string;
      output?: OutputShape;
      source?: string;
    }
  | { event: "watching"; paths: string[] }
  | { event: "reloading"; files: string[] }
  | { event: "stopping"; signal: string }
  | { event: "stopped"; exitCode: number }
  | { event: "manifest"; path: string; source: "fileable.config.json" | "package.json"; manifest: Record<string, unknown> }
  | { event: "version"; fileable: string; node: string; eventsSchemaVersion: number };

export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

export function defaultIo(): Io {
  const out = process.stdout.write.bind(process.stdout);
  const err = process.stderr.write.bind(process.stderr);
  return { stdout: (t) => void out(t), stderr: (t) => void err(t) };
}

/**
 * In `--json` mode stdout carries events and nothing else: while a template
 * is imported or rendered, anything it prints with console.log or
 * process.stdout.write goes to stderr instead.
 */
export async function withStdoutToStderr<T>(enabled: boolean, io: Io, run: () => Promise<T>): Promise<T> {
  if (!enabled) return run();
  const original = process.stdout.write;
  process.stdout.write = ((chunk: unknown, encoding?: unknown, callback?: unknown) => {
    io.stderr(typeof chunk === "string" ? chunk : Buffer.from(chunk as Uint8Array).toString(typeof encoding === "string" ? (encoding as BufferEncoding) : "utf8"));
    const cb = typeof encoding === "function" ? encoding : callback;
    if (typeof cb === "function") (cb as () => void)();
    return true;
  }) as typeof process.stdout.write;
  try {
    return await run();
  } finally {
    process.stdout.write = original;
  }
}

export class Emitter {
  /**
   * @param redirectStdout in json mode, send the template's own stdout
   *   writes to stderr while it runs (on for the real CLI; off when a caller
   *   of main() supplies its own io, since then stdout isn't the event
   *   channel).
   */
  constructor(
    readonly json: boolean,
    readonly io: Io,
    readonly redirectStdout = json,
  ) {}

  /** Writes one event as a JSON line (json mode only). */
  emit(event: FileableEvent): void {
    if (!this.json) return;
    const { event: name, ...fields } = event;
    this.io.stdout(`${JSON.stringify({ v: EVENTS_SCHEMA_VERSION, event: name, time: new Date().toISOString(), ...fields })}\n`);
  }

  /** Human-mode line on stdout (ignored in json mode). */
  say(line: string): void {
    if (!this.json) this.io.stdout(`${line}\n`);
  }

  /** Human-mode line on stderr (ignored in json mode). */
  warn(line: string): void {
    if (!this.json) this.io.stderr(`${line}\n`);
  }

  warning(warning: FileableWarning): void {
    if (this.json) this.emit({ event: "warning", ...warning });
    else this.io.stderr(`fileable: warning: ${warning.message}\n`);
  }

  error(description: ErrorDescription, context?: string): void {
    if (this.json) {
      this.emit({ event: "error", ...description });
      return;
    }
    const prefix = context ? `fileable: ${context}\n` : "";
    const causes = (description.causes ?? []).map((c) => `  caused by: ${c}\n`).join("");
    this.io.stderr(`${prefix}fileable: error ${description.code}: ${description.message}\n${causes}`);
  }
}

export function outputShape(outDir: string, outputs: OutputEntry[]): OutputShape {
  const roots = outputs
    .filter((o) => o.root)
    .map((o) => ({ path: o.path, kind: o.kind, encode: o.encode, hash: o.hash }));
  const encodes = new Set(roots.map((r) => r.encode));
  const shape = roots.length === 0 ? "empty" : encodes.size === 1 ? [...encodes][0] : "mixed";
  return { outDir, shape, roots };
}
