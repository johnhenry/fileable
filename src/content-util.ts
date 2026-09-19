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
