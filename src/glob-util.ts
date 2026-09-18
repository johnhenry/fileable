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
