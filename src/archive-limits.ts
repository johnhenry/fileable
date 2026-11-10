/**
 * Limits on what `<Dir src decode="zip"|"wbn">` may inflate (#32). An
 * archive is untrusted input (README's "Security model"): a few kilobytes of
 * deflate can claim, and really produce, gigabytes (a zip bomb). Every limit
 * is enforced while inflating -- fileable stops as soon as one is crossed
 * rather than inflating everything and measuring afterwards -- and a crossed
 * limit throws `E_ARCHIVE_LIMIT`.
 *
 * Precedence, per key: the `<Dir decodeLimits>` prop, then the
 * `decodeLimits` render option (the CLI flags and the manifest's
 * `"decodeLimits"` set this), then `DEFAULT_DECODE_LIMITS`.
 */
import { FileableError } from "./types.js";
import type { ErrorCode } from "./types.js";

export interface DecodeLimits {
  /** Total uncompressed bytes one archive may produce. */
  maxBytes?: number;
  /** Entries one archive may contain (directory entries included). */
  maxEntries?: number;
  /** Uncompressed bytes one entry may produce. */
  maxEntryBytes?: number;
  /**
   * Uncompressed / compressed bytes, per zip entry and for a whole `.wbn`
   * (one gzip stream). Only checked once the output passes
   * `RATIO_GRACE_BYTES`, so small, very compressible files are fine.
   */
  maxRatio?: number;
}

const MiB = 1024 * 1024;

/**
 * Defaults (#32). Everything a decoded archive produces is held in memory
 * until it's written, so these bound memory as well as disk:
 * - `maxBytes` 1 GiB: far above a site or package bundle, well below what
 *   exhausts a typical machine.
 * - `maxEntries` 100,000: more files than real bundles carry, while a
 *   million-tiny-entries archive is refused before any entry is read.
 * - `maxEntryBytes` 256 MiB: room for large media files.
 * - `maxRatio` 100: text and code compress about 3-20x and very repetitive
 *   data rarely passes 100x; deflate tops out near 1032x, which is what a
 *   bomb uses.
 */
export const DEFAULT_DECODE_LIMITS: Readonly<Required<DecodeLimits>> = Object.freeze({
  maxBytes: 1024 * MiB,
  maxEntries: 100_000,
  maxEntryBytes: 256 * MiB,
  maxRatio: 100,
});

/** Output below this size is never refused for its compression ratio. */
export const RATIO_GRACE_BYTES = 1 * MiB;

const KEYS = ["maxBytes", "maxEntries", "maxEntryBytes", "maxRatio"] as const;
export type DecodeLimitKey = (typeof KEYS)[number];

/** Where each limit can be raised, for error messages. */
const FLAGS: Record<DecodeLimitKey, string> = {
  maxBytes: "--max-decoded-bytes",
  maxEntries: "--max-decoded-entries",
  maxEntryBytes: "--max-entry-bytes",
  maxRatio: "--max-compression-ratio",
};

/** Checks a `DecodeLimits` object; `Infinity` turns a limit off. */
export function validateDecodeLimits(value: unknown, where: string, path: string, code: ErrorCode): DecodeLimits {
  if (value === undefined) return {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new FileableError(`${where} must be an object with maxBytes, maxEntries, maxEntryBytes and/or maxRatio`, path, undefined, code);
  }
  const limits = value as Record<string, unknown>;
  for (const key of Object.keys(limits)) {
    if (!(KEYS as readonly string[]).includes(key)) {
      throw new FileableError(`unknown key "${key}" in ${where} -- expected maxBytes, maxEntries, maxEntryBytes or maxRatio`, path, undefined, code);
    }
    const v = limits[key];
    if (v === undefined) continue;
    const ok = typeof v === "number" && v > 0 && (v === Infinity || (key === "maxRatio" ? Number.isFinite(v) : Number.isSafeInteger(v)));
    if (!ok) {
      const kind = key === "maxRatio" ? "a number > 0" : "an integer > 0";
      throw new FileableError(`${where}.${key} must be ${kind} (or Infinity for no limit), got ${JSON.stringify(v)}`, path, undefined, code);
    }
  }
  return limits as DecodeLimits;
}

export function effectiveDecodeLimits(option: DecodeLimits | undefined, prop: DecodeLimits | undefined): Required<DecodeLimits> {
  const out = { ...DEFAULT_DECODE_LIMITS };
  for (const key of KEYS) {
    const v = prop?.[key] ?? option?.[key];
    if (v !== undefined) out[key] = v;
  }
  return out;
}

export function formatBytes(n: number): string {
  if (n === Infinity) return "unlimited";
  if (n >= MiB && n % MiB === 0) return `${n / MiB} MiB`;
  if (n >= 1024 && n % 1024 === 0) return `${n / 1024} KiB`;
  return `${n} bytes`;
}

export function archiveLimitError(format: string, what: string, key: DecodeLimitKey, limit: number, path: string): FileableError {
  const shown = key === "maxRatio" ? `${limit}:1` : key === "maxEntries" ? String(limit) : formatBytes(limit);
  return new FileableError(
    `\`decode="${format}"\` stopped -- ${what}, over the ${key} limit of ${shown}. ` +
      `If the archive is trusted, raise it with <Dir decodeLimits={{ ${key}: ... }}>, the decodeLimits render option or manifest key, or ${FLAGS[key]}`,
    path, undefined, "E_ARCHIVE_LIMIT",
  );
}

/**
 * Counts what one archive produces as it is inflated. `entry()` starts a
 * zip entry; `progress()` is called with that entry's running totals and
 * throws `E_ARCHIVE_LIMIT` the moment a limit is crossed.
 */
export class DecodeMeter {
  private finishedBytes = 0;
  private name = "";

  constructor(
    readonly limits: Required<DecodeLimits>,
    private readonly format: "zip" | "wbn",
    private readonly path: string,
  ) {}

  private fail(what: string, key: DecodeLimitKey): never {
    throw archiveLimitError(this.format, what, key, this.limits[key], this.path);
  }

  /** Before reading anything: the entry count and the sizes the archive declares. */
  checkDeclared(entries: number, declaredSizes: Array<[string, number]>): void {
    if (entries > this.limits.maxEntries) this.fail(`the archive has ${entries} entries`, "maxEntries");
    let total = 0;
    for (const [name, size] of declaredSizes) {
      if (size > this.limits.maxEntryBytes) this.fail(`entry ${JSON.stringify(name)} declares ${formatBytes(size)}`, "maxEntryBytes");
      total += size;
      if (total > this.limits.maxBytes) this.fail(`its entries declare more than ${formatBytes(this.limits.maxBytes)} in total`, "maxBytes");
    }
  }

  entry(name: string): void {
    this.name = name;
  }

  /** `produced`/`consumed`: this entry's uncompressed output and compressed input so far. */
  progress(produced: number, consumed: number): void {
    const label = this.format === "zip" ? `entry ${JSON.stringify(this.name)}` : "the bundle";
    if (produced > this.limits.maxEntryBytes && this.format === "zip") this.fail(`${label} inflates past ${formatBytes(this.limits.maxEntryBytes)}`, "maxEntryBytes");
    if (this.finishedBytes + produced > this.limits.maxBytes) this.fail(`the archive inflates past ${formatBytes(this.limits.maxBytes)}`, "maxBytes");
    if (produced > RATIO_GRACE_BYTES && produced > this.limits.maxRatio * Math.max(consumed, 1)) {
      this.fail(`${label} inflates ${formatBytes(produced)} from ${formatBytes(consumed)} of compressed data`, "maxRatio");
    }
  }

  /** Call when an entry is done, with its final size. */
  done(produced: number): void {
    this.finishedBytes += produced;
  }
}
