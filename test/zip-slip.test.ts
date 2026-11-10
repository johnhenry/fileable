/**
 * #28: `<Dir src decode="zip">` must never write outside the output root.
 * Every unsafe entry shape throws E_UNSAFE_ENTRY before anything is written,
 * on POSIX and Windows alike, using the same rule as `decode="wbn"` (#20).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { deflateSync, strToU8, zipSync } from "fflate";
import * as wbn from "wbn";
import { unsafeArchivePathReason } from "../src/archive-path.js";
import { render } from "../src/render.js";
import { FileableError } from "../src/types.js";
import type { Descriptor } from "../src/types.js";
import { readZipEntries } from "../src/zip-read.js";

interface RawEntry {
  /** Raw name bytes (Latin-1 string) or a UTF-8 string when `utf8` is set. */
  name: string;
  data?: Uint8Array;
  /** "Version made by" host byte: 3 = Unix, 0 = MS-DOS. */
  host?: number;
  /** Unix st_mode, stored in the high 16 bits of the external attributes. */
  mode?: number;
  dosAttributes?: number;
  utf8?: boolean;
  deflate?: boolean;
}

/**
 * Builds a zip by hand, so names and attributes are exactly what an attacker
 * (or another tool) chooses -- including duplicates and Zip64 records, which
 * fflate's own zipSync() can't produce.
 */
function rawZip(entries: RawEntry[], { zip64 = false } = {}): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = entry.utf8 ? strToU8(entry.name) : strToU8(entry.name, true);
    const data = entry.data ?? new Uint8Array(0);
    const stored = entry.deflate ? deflateSync(data) : data;
    const method = entry.deflate ? 8 : 0;
    const flags = entry.utf8 ? 0x800 : 0;

    const local = new Uint8Array(30 + name.length + stored.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, flags, true);
    lv.setUint16(8, method, true);
    lv.setUint32(18, stored.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(stored, 30 + name.length);

    const extra = zip64 ? 28 : 0;
    const central = new Uint8Array(46 + name.length + extra);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, ((entry.host ?? 3) << 8) | 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, flags, true);
    cv.setUint16(10, method, true);
    cv.setUint32(20, zip64 ? 0xffffffff : stored.length, true);
    cv.setUint32(24, zip64 ? 0xffffffff : data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint16(30, extra, true);
    cv.setUint32(38, (((entry.mode ?? 0o100644) << 16) | (entry.dosAttributes ?? 0)) >>> 0, true);
    cv.setUint32(42, zip64 ? 0xffffffff : offset, true);
    central.set(name, 46);
    if (zip64) {
      const at = 46 + name.length;
      cv.setUint16(at, 0x0001, true);
      cv.setUint16(at + 2, 24, true);
      cv.setBigUint64(at + 4, BigInt(data.length), true);
      cv.setBigUint64(at + 12, BigInt(stored.length), true);
      cv.setBigUint64(at + 20, BigInt(offset), true);
    }
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const cdSize = centrals.reduce((n, c) => n + c.length, 0);
  const tail: Uint8Array[] = [];
  if (zip64) {
    const record = new Uint8Array(56);
    const rv = new DataView(record.buffer);
    rv.setUint32(0, 0x06064b50, true);
    rv.setBigUint64(4, 44n, true);
    rv.setBigUint64(24, BigInt(entries.length), true);
    rv.setBigUint64(32, BigInt(entries.length), true);
    rv.setBigUint64(40, BigInt(cdSize), true);
    rv.setBigUint64(48, BigInt(offset), true);
    const locator = new Uint8Array(20);
    const xv = new DataView(locator.buffer);
    xv.setUint32(0, 0x07064b50, true);
    xv.setBigUint64(8, BigInt(offset + cdSize), true);
    xv.setUint32(16, 1, true);
    tail.push(record, locator);
  }
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, zip64 ? 0xffff : entries.length, true);
  ev.setUint16(10, zip64 ? 0xffff : entries.length, true);
  ev.setUint32(12, zip64 ? 0xffffffff : cdSize, true);
  ev.setUint32(16, zip64 ? 0xffffffff : offset, true);
  tail.push(eocd);
  return Buffer.concat([...locals, ...centrals, ...tail]);
}

/**
 * Renders `<Dir name="out" src="evil.zip" decode="zip">` into `<root>/a/b`
 * (so a `..` has two real levels to climb into) and returns the error.
 * Asserts nothing was written anywhere under `<root>` except the archive.
 */
async function renderUnsafe(zip: Uint8Array): Promise<FileableError> {
  const root = await mkdtemp(join(tmpdir(), "fileable-zip-slip-"));
  try {
    const outDir = join(root, "a", "b");
    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, "evil.zip"), zip);
    const tree: Descriptor = { tag: "dir", props: { name: "out", src: "evil.zip", decode: "zip" }, children: [] };
    let caught: unknown;
    try {
      await render(tree, { outDir });
    } catch (error) {
      caught = error;
    }
    assert.ok(caught instanceof FileableError, `expected a FileableError, got ${String(caught)}`);
    const everything = (await readdir(root, { recursive: true })).map((p) => p.replaceAll("\\", "/")).sort();
    assert.deepEqual(everything, ["a", "a/b", "a/b/evil.zip"], "nothing from the archive may be written");
    return caught;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const UNSAFE_NAMES: ReadonlyArray<readonly [label: string, name: string, reason: string]> = [
  ["a leading ../", "../escaped.txt", "traversal"],
  ["a deep ../../", "../../escaped.txt", "traversal"],
  ["a .. in the middle that normalizes outside", "x/../../escaped.txt", "traversal"],
  ["a .. that normalizes back inside", "x/../y.txt", "traversal"],
  ["a trailing ..", "x/..", "traversal"],
  ["a POSIX absolute path", "/tmp/escaped.txt", "absolute"],
  ["a //server/share UNC path", "//server/share/escaped.txt", "absolute"],
  ["a Windows backslash ..\\", "..\\escaped.txt", "backslash"],
  ["a Windows backslash nested", "x\\..\\..\\escaped.txt", "backslash"],
  ["a Windows backslash absolute", "\\Windows\\escaped.txt", "backslash"],
  ["a Windows \\\\?\\ device path", "\\\\?\\C:\\escaped.txt", "backslash"],
  ["a Windows drive-absolute path", "C:/escaped.txt", "absolute"],
  ["a Windows drive-relative path", "C:escaped.txt", "absolute"],
  ["a lowercase drive letter", "z:/escaped.txt", "absolute"],
  ["a NUL byte", "ok.txt\u0000../../escaped.txt", "control-character"],
  ["a newline", "a\nb.txt", "control-character"],
  ["DEL", "a\u007fb.txt", "control-character"],
  ["an empty segment", "x//escaped.txt", "empty-segment"],
  ["a . segment", "./escaped.txt", "dot-segment"],
  ["a ... segment (Windows trims it)", ".../escaped.txt", "dot-segment"],
  ["a '.. ' segment (Windows trims it to ..)", ".. /escaped.txt", "traversal"],
  ["a '. .' segment", ". ./escaped.txt", "dot-segment"],
  ["a .. directory entry", "../", "traversal"],
];

for (const [label, name, reason] of UNSAFE_NAMES) {
  test(`decode="zip" refuses ${label} with E_UNSAFE_ENTRY (#28)`, async () => {
    const error = await renderUnsafe(rawZip([{ name: "fine.txt", data: strToU8("ok") }, { name, data: strToU8("pwned") }]));
    assert.equal(error.code, "E_UNSAFE_ENTRY");
    assert.match(error.message, new RegExp(`\\(${reason}\\)`));
  });
}

test('decode="zip" refuses a ../ name written by a real zip tool (fflate), not just a hand-built one (#28)', async () => {
  const error = await renderUnsafe(zipSync({ "../../escaped.txt": strToU8("pwned") }));
  assert.equal(error.code, "E_UNSAFE_ENTRY");
});

test('decode="zip" refuses a UTF-8-flagged name with a .. segment (#28)', async () => {
  const error = await renderUnsafe(rawZip([{ name: "ü/../../escaped.txt", utf8: true, data: strToU8("pwned") }]));
  assert.equal(error.code, "E_UNSAFE_ENTRY");
});

test('decode="zip" refuses a symlink entry, even one pointing inside the root (#28)', async () => {
  for (const target of ["/etc", "../../..", "inside.txt"]) {
    const error = await renderUnsafe(rawZip([
      { name: "inside.txt", data: strToU8("ok") },
      { name: "link", mode: 0o120777, data: strToU8(target) },
    ]));
    assert.equal(error.code, "E_UNSAFE_ENTRY");
    assert.match(error.message, /\(symlink\)/);
  }
});

test('decode="zip" refuses a symlink followed by an entry that writes through it (#28)', async () => {
  const error = await renderUnsafe(rawZip([
    { name: "link", mode: 0o120777, data: strToU8("../../..") },
    { name: "link/escaped.txt", data: strToU8("pwned") },
  ]));
  assert.equal(error.code, "E_UNSAFE_ENTRY");
  assert.match(error.message, /\(symlink\)/);
});

test('decode="zip" refuses device and FIFO entries (#28)', async () => {
  for (const mode of [0o010644 /* FIFO */, 0o020644 /* char device */, 0o060644 /* block device */, 0o140644 /* socket */]) {
    const error = await renderUnsafe(rawZip([{ name: "dev", mode }]));
    assert.equal(error.code, "E_UNSAFE_ENTRY");
    assert.match(error.message, /\(special-file\)/);
  }
});

test('decode="zip" refuses duplicate entry names instead of keeping one silently (#28)', async () => {
  const error = await renderUnsafe(rawZip([
    { name: "a.txt", data: strToU8("first") },
    { name: "a.txt", data: strToU8("second") },
  ]));
  assert.equal(error.code, "E_UNSAFE_ENTRY");
  assert.match(error.message, /\(duplicate\)/);
});

test('decode="zip" writes legitimate nested names, dotted names and a __proto__ entry under the root (#28)', async () => {
  const root = await mkdtemp(join(tmpdir(), "fileable-zip-safe-"));
  try {
    const names = ["top.txt", "a/b/c/deep.txt", ".hidden/x.txt", "..foo", "foo..", "a..b/c...d.txt", "dir/", "ü/ß.txt", "__proto__", "constructor"];
    await writeFile(join(root, "ok.zip"), rawZip(names.map((name) => ({
      name,
      utf8: true,
      data: name.endsWith("/") ? undefined : strToU8(`content of ${name}`),
      mode: name.endsWith("/") ? 0o040755 : 0o100644,
      deflate: name === "a/b/c/deep.txt",
    }))));
    await render({ tag: "dir", props: { name: "out", src: "ok.zip", decode: "zip" }, children: [] }, { outDir: root });
    for (const name of names.filter((n) => !n.endsWith("/"))) {
      assert.equal(await readFile(join(root, "out", ...name.split("/")), "utf8"), `content of ${name}`);
    }
    await assert.rejects(() => access(join(root, "out", "dir")), "a directory entry synthesizes no File");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("readZipEntries reads Zip64 central directories and MS-DOS-made entries", () => {
  const entries = readZipEntries(rawZip([
    { name: "a.txt", data: strToU8("A"), deflate: true },
    { name: "b/c.txt", data: strToU8("BC"), host: 0, mode: 0 },
  ], { zip64: true }));
  assert.deepEqual(entries.map((e) => [e.name, e.unixType, e.isDirectory]), [["a.txt", 0o100000, false], ["b/c.txt", 0, false]]);
  assert.deepEqual(entries.map((e) => new TextDecoder().decode(e.read())), ["A", "BC"]);
});

test('decode="zip" refuses an unsafe name inside a Zip64 archive (#28)', async () => {
  const error = await renderUnsafe(rawZip([{ name: "../escaped.txt", data: strToU8("pwned") }], { zip64: true }));
  assert.equal(error.code, "E_UNSAFE_ENTRY");
});

test('a truncated zip is E_DECODE, not a crash', async () => {
  const zip = rawZip([{ name: "a.txt", data: strToU8("A") }]);
  const error = await renderUnsafe(zip.subarray(10));
  assert.equal(error.code, "E_DECODE");
});

/** Builds a gzip(Web Bundle) with exactly these exchange URLs. */
function foreignWbn(urls: string[]): Uint8Array {
  const builder = new wbn.BundleBuilder();
  for (const url of urls) builder.addExchange(url, 200, { "Content-Type": "text/plain" }, "X");
  builder.setPrimaryURL("https://packfile.invalid/");
  return gzipSync(Buffer.from(builder.createBundle()));
}

test("decode=\"zip\" and decode=\"wbn\" agree on every unsafe name (one shared rule)", async () => {
  for (const [, name, reason] of UNSAFE_NAMES) {
    assert.equal(unsafeArchivePathReason(name.endsWith("/") ? name.slice(0, -1) : name), reason, name);
    // The same name, percent-encoded into a wbn exchange URL, is refused by
    // decode="wbn" with the same code and reason.
    const root = await mkdtemp(join(tmpdir(), "fileable-wbn-agree-"));
    try {
      const encoded = name.endsWith("/") ? name.slice(0, -1) : name;
      await writeFile(join(root, "evil.wbn"), foreignWbn([`https://packfile.invalid/${encodeURIComponent(encoded)}`]));
      await assert.rejects(
        () => render({ tag: "dir", props: { name: "out", src: "evil.wbn", decode: "wbn" }, children: [] }, { outDir: root }),
        (err: unknown) => err instanceof FileableError && err.code === "E_UNSAFE_ENTRY" && err.message.includes(`(${reason})`),
        name,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("unsafeArchivePathReason accepts ordinary names", () => {
  for (const name of ["a.txt", "a/b/c.txt", ".hidden", "..foo", "foo..", "a b/c d.txt", "ü/ß.txt", "C", "__proto__"]) {
    assert.equal(unsafeArchivePathReason(name), undefined, name);
  }
});
