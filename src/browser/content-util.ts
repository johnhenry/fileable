/**
 * Browser-safe analog of ../content-util.ts (PRD SS2.2's binary-safe content
 * handling), rebuilt on `Uint8Array`/`TextEncoder`/`TextDecoder`/`atob`
 * instead of Node's `Buffer` -- `Buffer` is a Node global with no browser
 * equivalent, so it can't appear anywhere in this directory's module graph
 * (issue #6). Every function here mirrors its Node counterpart's exact
 * validation/round-trip logic; only the byte-container type differs.
 */

import { FileableError } from "../types.js";

/**
 * Decode `<File base64>` content strictly -- same validation as
 * ../content-util.ts's `decodeBase64Strict` (whitespace stripped, then
 * strict base64-alphabet + padding check, so a typo'd base64 string throws
 * instead of silently decoding to the wrong bytes), but via `atob` (a
 * browser/Node-global, unlike `Buffer.from(str, "base64")`) instead.
 */
export function decodeBase64Strict(value: string, path: string): Uint8Array {
  const cleaned = value.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(cleaned) || cleaned.length % 4 !== 0) {
    const preview = value.length > 40 ? `${value.slice(0, 40)}...` : value;
    throw new FileableError(`invalid base64 content: "${preview}"`, path);
  }
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Round-trip UTF-8 check, same technique as ../content-util.ts's
 * `isUtf8Text` (decode, re-encode, compare bytes) -- `TextDecoder`'s
 * default (non-fatal) mode replaces invalid sequences with U+FFFD exactly
 * like `Buffer#toString("utf8")` does, so re-encoding and comparing byte
 * lengths/values catches the same "this wasn't valid UTF-8" cases.
 */
export function isUtf8Text(bytes: Uint8Array): boolean {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const reencoded = new TextEncoder().encode(text);
  if (reencoded.length !== bytes.length) return false;
  for (let i = 0; i < bytes.length; i++) {
    if (reencoded[i] !== bytes[i]) return false;
  }
  return true;
}

/** Returns a `string` if the bytes round-trip as UTF-8, else the raw `Uint8Array`. */
export function bufferToContent(bytes: Uint8Array): string | Uint8Array {
  return isUtf8Text(bytes) ? new TextDecoder("utf-8").decode(bytes) : bytes;
}

/** Same combination rule as ../content-util.ts's `combineContent` (text+text stays a string; either side binary drops to byte concat). */
export function combineContent(
  a: string | Uint8Array | undefined,
  b: string | Uint8Array,
): string | Uint8Array {
  if (a === undefined) return b;
  if (typeof a === "string" && typeof b === "string") return a + b;
  const encoder = new TextEncoder();
  const bytesA = typeof a === "string" ? encoder.encode(a) : a;
  const bytesB = typeof b === "string" ? encoder.encode(b) : b;
  const combined = new Uint8Array(bytesA.length + bytesB.length);
  combined.set(bytesA, 0);
  combined.set(bytesB, bytesA.length);
  return combined;
}
