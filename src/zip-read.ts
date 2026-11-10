/**
 * Reads a zip archive's central directory for `<Dir src decode="zip">` (#28).
 *
 * fflate's `unzipSync()` returns entries as a plain object keyed by name,
 * which hides what fileable needs to check before trusting an entry: its
 * Unix file type (a symlink is stored as a regular entry whose bytes are the
 * link target, with the type in the high 16 bits of the external
 * attributes), duplicate names (an object keeps only the last), and a name of
 * `__proto__` (assigning it to `{}` sets the prototype, so the entry
 * vanishes). So this walks the central directory itself, the same way
 * `unzipSync()` does (including Zip64), and only uses fflate to inflate.
 *
 * Throws a plain `Error` for a malformed archive; the caller wraps it as
 * `E_DECODE`.
 */
import { Inflate } from "fflate";

export interface ZipEntry {
  /** The entry name as stored (UTF-8 if general-purpose flag bit 11 is set, else Latin-1, as fflate reads it). */
  name: string;
  /** Unix file type bits (`mode & 0o170000`) when the entry was made on Unix and records one, else 0. */
  unixType: number;
  /** True for a directory entry: a trailing `/`, the Unix directory type, or the MS-DOS directory attribute on an empty entry. */
  isDirectory: boolean;
  /** Uncompressed size the central directory declares (untrusted). */
  size: number;
  /** Compressed size the central directory declares. */
  compressedSize: number;
  /**
   * Inflates the entry's bytes in small steps. `onProgress(produced,
   * consumed)` runs after each step with the running output and input sizes;
   * throwing from it stops inflation there (#32). Nothing is preallocated
   * from the declared size.
   */
  read(onProgress?: (produced: number, consumed: number) => void): Uint8Array;
}

export const S_IFMT = 0o170000;
export const S_IFREG = 0o100000;
export const S_IFDIR = 0o040000;
export const S_IFLNK = 0o120000;

const EOCD = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_EOCD = 0x06064b50;
const CENTRAL_HEADER = 0x02014b50;
const LOCAL_HEADER = 0x04034b50;
const MAX_32 = 0xffffffff;

const utf8 = new TextDecoder();

function latin1(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 16384) s += String.fromCharCode(...bytes.subarray(i, i + 16384));
  return s;
}

/** Compressed bytes fed to the inflater per step: at deflate's ~1032:1 maximum, at most ~16 MiB of output between checks. */
const INFLATE_STEP = 16 * 1024;

function inflateInSteps(raw: Uint8Array, onProgress?: (produced: number, consumed: number) => void): Uint8Array {
  const chunks: Uint8Array[] = [];
  let produced = 0;
  let consumed = 0;
  let finished = false;
  const inflater = new Inflate((chunk, final) => {
    chunks.push(chunk);
    produced += chunk.length;
    if (final) finished = true;
    onProgress?.(produced, consumed);
  });
  if (raw.length === 0) inflater.push(raw, true);
  for (let at = 0; at < raw.length; at += INFLATE_STEP) {
    const end = Math.min(raw.length, at + INFLATE_STEP);
    consumed = end;
    inflater.push(raw.subarray(at, end), end === raw.length);
  }
  if (!finished) throw new Error("truncated deflate stream");
  if (chunks.length === 1) return chunks[0];
  const out = new Uint8Array(produced);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export function readZipEntries(data: Uint8Array): ZipEntry[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const u16 = (at: number) => {
    if (at < 0 || at + 2 > data.length) throw new Error("truncated zip");
    return view.getUint16(at, true);
  };
  const u32 = (at: number) => {
    if (at < 0 || at + 4 > data.length) throw new Error("truncated zip");
    return view.getUint32(at, true);
  };
  const u64 = (at: number) => {
    if (at < 0 || at + 8 > data.length) throw new Error("truncated zip");
    const value = view.getBigUint64(at, true);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("zip64 value out of range");
    return Number(value);
  };

  // End of central directory: the last EOCD signature within the trailing
  // comment window (22-byte record + up to 65535 bytes of comment).
  let eocd = data.length - 22;
  for (; ; eocd--) {
    if (eocd < 0 || data.length - eocd > 22 + 0xffff) throw new Error("no end-of-central-directory record");
    if (u32(eocd) === EOCD) break;
  }
  let count = u16(eocd + 10);
  let offset = u32(eocd + 16);
  let zip64 = false;
  if (eocd >= 20 && u32(eocd - 20) === ZIP64_LOCATOR) {
    const z = u64(eocd - 12);
    if (u32(z) === ZIP64_EOCD) {
      zip64 = true;
      count = u64(z + 32);
      offset = u64(z + 48);
    }
  }

  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (u32(offset) !== CENTRAL_HEADER) throw new Error(`bad central directory header for entry ${i}`);
    const madeBy = u16(offset + 4) >> 8;
    const flags = u16(offset + 8);
    const method = u16(offset + 10);
    let compressedSize = u32(offset + 20);
    let size = u32(offset + 24);
    const nameLength = u16(offset + 28);
    const extraLength = u16(offset + 30);
    const commentLength = u16(offset + 32);
    const externalAttributes = u32(offset + 38);
    let localOffset = u32(offset + 42);
    const nameStart = offset + 46;
    if (nameStart + nameLength > data.length) throw new Error("truncated zip");
    const nameBytes = data.subarray(nameStart, nameStart + nameLength);
    const name = flags & 0x800 ? utf8.decode(nameBytes) : latin1(nameBytes);

    // Zip64 extended information: only the fields saturated in the header
    // are present, in this fixed order.
    if (zip64 || compressedSize === MAX_32 || size === MAX_32 || localOffset === MAX_32) {
      const extraEnd = nameStart + nameLength + extraLength;
      for (let at = nameStart + nameLength; at + 4 <= extraEnd; at += 4 + u16(at + 2)) {
        if (u16(at) !== 0x0001) continue;
        let field = at + 4;
        if (size === MAX_32) { size = u64(field); field += 8; }
        if (compressedSize === MAX_32) { compressedSize = u64(field); field += 8; }
        if (localOffset === MAX_32) { localOffset = u64(field); field += 8; }
        break;
      }
    }

    const unixType = madeBy === 3 ? (externalAttributes >>> 16) & S_IFMT : 0;
    const isDirectory = name.endsWith("/") || unixType === S_IFDIR || ((externalAttributes & 0x10) !== 0 && size === 0);
    const entryIndex = i;
    entries.push({
      name,
      unixType,
      isDirectory,
      size,
      compressedSize,
      read(onProgress) {
        if (flags & 0x1) throw new Error(`entry ${entryIndex} is encrypted`);
        if (u32(localOffset) !== LOCAL_HEADER) throw new Error(`bad local header for entry ${entryIndex}`);
        const start = localOffset + 30 + u16(localOffset + 26) + u16(localOffset + 28);
        if (start + compressedSize > data.length) throw new Error("truncated zip");
        const raw = data.subarray(start, start + compressedSize);
        if (method === 0) {
          onProgress?.(raw.length, raw.length);
          return raw.slice();
        }
        if (method === 8) return inflateInSteps(raw, onProgress);
        throw new Error(`entry ${entryIndex} uses unsupported compression method ${method}`);
      },
    });
    offset = nameStart + nameLength + extraLength + commentLength;
  }
  return entries;
}
