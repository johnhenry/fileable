/**
 * The `glob` package requires forward-slash patterns even on Windows --
 * passing an OS-native (backslash) path as a pattern silently matches
 * nothing rather than erroring, which is easy to miss. Every place that
 * builds a pattern from a filesystem path (rather than accepting one
 * verbatim from an author) normalizes through this first.
 */
export function toPosixPattern(pattern: string): string {
  return pattern.replace(/\\/g, "/");
}

/**
 * Splits a glob pattern into its fixed directory prefix and the remaining
 * glob-bearing suffix, e.g. "assets/**\/*" -> { base: "assets", rest:
 * "**\/*" }. Used both to scope a negated `<rm>` to its own directory
 * (write/loose.ts) and to preserve `<dir from>`'s matched files' relative
 * subdirectory structure instead of flattening them to a bare basename
 * (resolve.ts).
 */
export function splitGlobBase(pattern: string): { base: string; rest: string } {
  const specialIndex = pattern.search(/[*?{[]/);
  if (specialIndex === -1) return { base: "", rest: pattern };
  const slashIndex = pattern.lastIndexOf("/", specialIndex);
  if (slashIndex === -1) return { base: "", rest: pattern };
  return { base: pattern.slice(0, slashIndex), rest: pattern.slice(slashIndex + 1) };
}
