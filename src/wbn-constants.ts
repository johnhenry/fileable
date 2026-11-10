/**
 * Shared between write/wbn.ts (encode) and resolve.ts's `<Dir src decode="wbn">`
 * (decode) -- an internal-only base URL used purely to satisfy the Web
 * Bundle format's absolute-URL requirement per exchange, immediately
 * stripped back off on decode. Mirrors `@johnhenry/packfile`'s own exactly
 * (the IANA/RFC 2606 `.invalid` TLD, guaranteed to never resolve to a real
 * origin), so a file produced by either side is byte-for-byte identical in
 * shape to one that package would produce.
 */
export const ARCHIVE_BASE_URL = "https://packfile.invalid/";

/**
 * Percent-encode each `/`-separated segment of a relative output path, the
 * same way `@johnhenry/packfile`'s `toWebBundle()` does (`encodePath()` in its
 * `lib/path-safety.mjs`), so any file name survives a trip through an
 * exchange URL (#20). Without it, `#` makes `wbn` reject the exchange URL,
 * and a literal `?` or `%` is read back by packfile as a query or a malformed
 * escape and the entry is dropped.
 */
export function encodeArchivePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

/**
 * The base an archive's exchange URLs are stripped against on decode -- the
 * same rule `@johnhenry/packfile` 0.2.x's `fromArchive()` uses
 * (`resolveArchiveBase()`): the root of the bundle's primary URL
 * (origin + "/"), or `ARCHIVE_BASE_URL` when there is no usable primary URL.
 * Archives written by fileable or packfile have `ARCHIVE_BASE_URL` as their
 * primary URL, so this is `ARCHIVE_BASE_URL` for them.
 */
export function archiveBase(primaryURL: string | null | undefined): string {
  if (typeof primaryURL === "string") {
    try {
      return new URL("/", primaryURL).href;
    } catch {
      // Opaque or unparseable primary URL: fall through to the default.
    }
  }
  return ARCHIVE_BASE_URL;
}

/**
 * Inverse of `encodeArchivePath()`: maps an exchange URL back to a decoded,
 * validated relative POSIX path, or the reason it can't be one. The reasons
 * and checks match `@johnhenry/packfile`'s `urlToPath()`/`checkPath()`, so
 * the two packages agree on which entries are readable -- except that
 * fileable throws on an unreadable entry where packfile skips it.
 */
export function archiveUrlToPath(url: string, base: string): { path: string } | { reason: string } {
  if (!url.startsWith(base)) return { reason: "outside-base" };
  const raw = url.slice(base.length);
  if (/[?#]/.test(raw)) return { reason: "query-or-fragment" };
  let path: string;
  try {
    path = decodeURIComponent(raw);
  } catch {
    return { reason: "malformed-encoding" };
  }
  if (path === "") return { reason: "empty" };
  if (path.includes("\\")) return { reason: "backslash" };
  if (/[\u0000-\u001f\u007f]/.test(path)) return { reason: "control-character" };
  if (path.startsWith("/") || /^[a-zA-Z]:/.test(path)) return { reason: "absolute" };
  for (const segment of path.split("/")) {
    if (segment === "") return { reason: "empty-segment" };
    if (segment === ".") return { reason: "dot-segment" };
    if (segment === "..") return { reason: "traversal" };
  }
  return { path };
}
