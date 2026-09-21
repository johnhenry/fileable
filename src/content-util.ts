/**
 * Binary-safe content handling for `src`/`cmd` (PRD SS2.2). Reading a `src`
 * file or a `cmd`'s stdout used to force UTF-8 decoding unconditionally,
 * which silently corrupts anything that isn't valid UTF-8 text (confirmed
 * by round-tripping a real PNG through `src` and diffing the bytes: every
 * non-UTF-8 byte came back as a replacement character, and the file grew
 * from 69 to 83 bytes).
 *
 * Fix: read raw bytes always, then decide text vs. binary by round-trip --
 * if decoding as UTF-8 and re-encoding produces the exact same bytes, it's
 * text (kept as a plain `string`, matching every existing behavior/test
 * exactly, since virtually all real text/HTML/JS/CSS files round-trip
 * cleanly); if not, it's binary (kept as a `Buffer`, byte-exact). Most of
 * the pipeline never needs to know which -- `fs.writeFile` and `fflate`'s
 * `zipSync` already accept a `Buffer` directly, so this only needed to
 * stop forcing a lossy decode at the two read points (resolve.ts, exec.ts).
 */

import { FileableError } from "./types.js";

/**
 * Decode `<File base64>` content strictly -- Node's `Buffer.from(str,
 * "base64")` is lenient by design (silently drops invalid characters
 * instead of throwing), which would let a typo'd base64 string produce
 * wrong-but-not-obviously-wrong content instead of a clear error, breaking
 * this project's established fail-loudly convention for every other
 * malformed/ambiguous input (invalid `onConflict`/`as`/`join`, a reserved
 * tag, ...). Whitespace/newlines are stripped first -- a common, expected
 * shape when a base64 blob is copy-pasted with line wrapping -- then what
 * remains must be validated strictly.
 *
 * @param value The raw `base64` prop value.
 * @param path For the thrown error's location, matching every other
 *   `FileableError` call site's convention.
 * @returns The decoded raw bytes.
 */
export function decodeBase64Strict(value: string, path: string): Buffer {
  const cleaned = value.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(cleaned) || cleaned.length % 4 !== 0) {
    const preview = value.length > 40 ? `${value.slice(0, 40)}...` : value;
    throw new FileableError(`invalid base64 content: "${preview}"`, path);
  }
  return Buffer.from(cleaned, "base64");
}

export function isUtf8Text(buffer: Buffer): boolean {
  const asText = buffer.toString("utf8");
  return Buffer.from(asText, "utf8").equals(buffer);
}

/** Returns a `string` if the bytes round-trip as UTF-8, else the raw `Buffer`. */
export function bufferToContent(buffer: Buffer): string | Buffer {
  return isUtf8Text(buffer) ? buffer.toString("utf8") : buffer;
}

/**
 * Combines two content values (e.g. `src`'s base content followed by
 * `cmd`'s stdout). Stays a plain string concatenation when both sides are
 * text -- identical to the pre-existing behavior -- and only drops to a
 * byte-level `Buffer.concat` when either side is binary.
 */
export function combineContent(
  a: string | Buffer | undefined,
  b: string | Buffer,
): string | Buffer {
  if (a === undefined) return b;
  if (typeof a === "string" && typeof b === "string") return a + b;
  const bufA = typeof a === "string" ? Buffer.from(a, "utf8") : a;
  const bufB = typeof b === "string" ? Buffer.from(b, "utf8") : b;
  return Buffer.concat([bufA, bufB]);
}
