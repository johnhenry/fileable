/**
 * The one rule both archive decoders (`<Dir src decode="zip">` and
 * `decode="wbn"`) use to decide whether an entry name may become a file name
 * (#20, #28). An archive is untrusted input (README's "Security model"), so
 * an entry name must be a plain relative POSIX path that stays inside the
 * `<Dir>` it is decoded into, on every platform fileable runs on.
 *
 * The checks match `@johnhenry/packfile`'s `checkPath()` (so fileable and
 * packfile agree on which entries are readable), plus one Windows-only shape
 * packfile doesn't list: a segment made only of dots and spaces (`...`,
 * `.. `), which Windows trims to `.` or `..`.
 */

/** Why an entry name was refused; part of the `E_UNSAFE_ENTRY` message. */
export type UnsafeArchivePathReason =
  | "empty"
  | "backslash"
  | "control-character"
  | "absolute"
  | "empty-segment"
  | "dot-segment"
  | "traversal";

/**
 * Returns the reason `path` (an already-decoded entry name) can't be written
 * under the output root, or `undefined` if it is safe. Rejects: the empty
 * name; any backslash (a separator on Windows); control characters
 * including NUL; a leading `/` (absolute, or a `//server` UNC path); a drive
 * letter (`C:`, `c:foo`); empty segments (`a//b`, a trailing `/`); `.`; `..`;
 * and segments of only dots and spaces.
 */
export function unsafeArchivePathReason(path: string): UnsafeArchivePathReason | undefined {
  if (path === "") return "empty";
  if (path.includes("\\")) return "backslash";
  if (/[\u0000-\u001f\u007f]/.test(path)) return "control-character";
  if (path.startsWith("/") || /^[a-zA-Z]:/.test(path)) return "absolute";
  for (const segment of path.split("/")) {
    if (segment === "") return "empty-segment";
    if (segment === "..") return "traversal";
    if (/^[. ]+$/.test(segment)) return segment.replace(/ +$/, "") === ".." ? "traversal" : "dot-segment";
  }
  return undefined;
}
