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
