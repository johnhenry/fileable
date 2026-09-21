/**
 * A small extension -> MIME type table, used only to give each entry in a
 * `<Dir encode="wbn">` archive (write/wbn.ts) a real `Content-Type`
 * header -- `wbn`'s `BundleBuilder.addExchange()` requires one for any
 * non-empty exchange body. Deliberately the same table (and the same
 * `Object.hasOwn()` lookup, not a naive `MIME_TYPES[extension]` index) as
 * `@johnhenry/packfile`'s own `lib/mime.mjs`, for real interop: a plain
 * object literal indexed by an attacker/user-influenced key (the file
 * extension) must use an own-property check, or an extension like
 * `"constructor"` or `"__proto__"` would resolve to an inherited
 * `Object.prototype` value instead of falling back to the default type --
 * a real bug packfile itself hit and fixed.
 */
const MIME_TYPES: Record<string, string> = {
  html: "text/html",
  htm: "text/html",
  css: "text/css",
  csv: "text/csv",
  txt: "text/plain",
  xml: "text/xml",
  markdown: "text/markdown",
  md: "text/markdown",

  js: "application/javascript",
  mjs: "application/javascript",
  cjs: "application/javascript",
  json: "application/json",
  jsonld: "application/ld+json",
  map: "application/json",

  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  bmp: "image/bmp",
  tiff: "image/tiff",
  tif: "image/tiff",

  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  eot: "application/vnd.ms-fontobject",

  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  wav: "audio/wav",
  mp4: "video/mp4",
  webm: "video/webm",

  pdf: "application/pdf",
  zip: "application/zip",
  gz: "application/gzip",
  tar: "application/x-tar",
  wasm: "application/wasm",
  bin: "application/octet-stream",

  manifest: "application/manifest+json",
  webmanifest: "application/manifest+json",
};

export function getContentType(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  if (Object.hasOwn(MIME_TYPES, extension)) {
    return MIME_TYPES[extension];
  }
  return "application/octet-stream";
}
