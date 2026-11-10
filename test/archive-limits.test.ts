/**
 * #32: `<Dir src decode="zip"|"wbn">` stops inflating once an archive
 * crosses a size limit (total bytes, entry count, per-entry bytes,
 * compression ratio) and throws E_ARCHIVE_LIMIT. The archives here are real
 * bomb shapes: highly compressed zeros, an entry whose declared size lies,
 * and many central-directory entries sharing one compressed stream
 * (overlapping entries, the "better zip bomb" layout).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { Deflate, strToU8 } from "fflate";
import * as wbn from "wbn";
import { render } from "../src/render.js";
import { resolve } from "../src/resolve.js";
import { DecodeMeter, DEFAULT_DECODE_LIMITS, effectiveDecodeLimits, RATIO_GRACE_BYTES } from "../src/archive-limits.js";
import type { DecodeLimits } from "../src/archive-limits.js";
import { readZipEntries } from "../src/zip-read.js";
import { ARCHIVE_BASE_URL } from "../src/wbn-constants.js";
import { ERROR_CODES } from "../src/errors.js";
import { FileableError } from "../src/types.js";
import type { Descriptor } from "../src/types.js";
import { validateManifest } from "../bin/manifest.js";

const MiB = 1024 * 1024;
const repoRoot = process.cwd();
const cli = join(repoRoot, "dist/bin/fileable.js");

/** Raw deflate of `bytes` zeros, made in 1 MiB steps so the plain data is never in memory at once. */
function deflatedZeros(bytes: number): Uint8Array {
  const parts: Uint8Array[] = [];
  const deflater = new Deflate({ level: 9 }, (chunk) => parts.push(chunk));
  const step = new Uint8Array(MiB);
  for (let left = bytes; left > 0; left -= MiB) deflater.push(left > MiB ? step : step.subarray(0, left), left <= MiB);
  if (bytes === 0) deflater.push(new Uint8Array(0), true);
  return Buffer.concat(parts);
}

interface Member {
  name: string;
  /** Compressed (or stored) bytes. Members with the same `shared` key point at one local record. */
  data: Uint8Array;
  method: 0 | 8;
  /** Uncompressed size written to the headers (may lie). */
  declared: number;
  shared?: string;
}

/** A zip whose members can share one local record (overlapping entries). */
function zipOf(members: Member[], { zip64 = false } = {}): Buffer {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  const offsets = new Map<string, number>();
  let offset = 0;
  for (const m of members) {
    const name = strToU8(m.name);
    const key = m.shared ?? `#${m.name}`;
    if (!offsets.has(key)) {
      const local = new Uint8Array(30 + name.length + m.data.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, 0x800, true);
      lv.setUint16(8, m.method, true);
      lv.setUint32(18, m.data.length, true);
      lv.setUint32(22, m.declared, true);
      lv.setUint16(26, name.length, true);
      local.set(name, 30);
      local.set(m.data, 30 + name.length);
      offsets.set(key, offset);
      locals.push(local);
      offset += local.length;
    }
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, (3 << 8) | 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x800, true);
    cv.setUint16(10, m.method, true);
    cv.setUint32(20, m.data.length, true);
    cv.setUint32(24, m.declared, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(38, (0o100644 << 16) >>> 0, true);
    cv.setUint32(42, offsets.get(key)!, true);
    central.set(name, 46);
    centrals.push(central);
  }
  const cdSize = centrals.reduce((n, c) => n + c.length, 0);
  const tail: Uint8Array[] = [];
  if (zip64) {
    // Zip64 end record + locator: the only way to say more than 65,535 entries.
    const record = new Uint8Array(56);
    const rv = new DataView(record.buffer);
    rv.setUint32(0, 0x06064b50, true);
    rv.setBigUint64(4, 44n, true);
    rv.setBigUint64(24, BigInt(members.length), true);
    rv.setBigUint64(32, BigInt(members.length), true);
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
  ev.setUint16(8, Math.min(members.length, 0xffff), true);
  ev.setUint16(10, Math.min(members.length, 0xffff), true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  return Buffer.concat([...locals, ...centrals, ...tail, eocd]);
}

/** A .wbn (gzip(webbundle)) holding the given files. */
function wbnOf(files: Record<string, Uint8Array>): Buffer {
  const builder = new wbn.BundleBuilder();
  for (const [name, body] of Object.entries(files)) builder.addExchange(new URL(name, ARCHIVE_BASE_URL).toString(), 200, { "Content-Type": "application/octet-stream" }, body);
  builder.setPrimaryURL(ARCHIVE_BASE_URL);
  return gzipSync(Buffer.from(builder.createBundle()), { level: 9 });
}

async function withDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "fileable-limits-")));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Renders `<Dir name="out" src=archive decode>` and returns the E_ARCHIVE_LIMIT error; nothing may be written. */
async function expectLimit(
  archive: Uint8Array,
  decode: "zip" | "wbn",
  key: keyof DecodeLimits,
  opts: { prop?: DecodeLimits; option?: DecodeLimits } = {},
): Promise<FileableError> {
  let caught: unknown;
  await withDir(async (dir) => {
    await writeFile(join(dir, `in.${decode}`), archive);
    const tree: Descriptor = { tag: "dir", props: { name: "out", src: `in.${decode}`, decode, ...(opts.prop ? { decodeLimits: opts.prop } : {}) }, children: [] };
    try {
      await render(tree, { outDir: dir, decodeLimits: opts.option });
    } catch (error) {
      caught = error;
    }
    assert.deepEqual(await readdir(dir), [`in.${decode}`], "nothing is written");
  });
  assert.ok(caught instanceof FileableError, `expected E_ARCHIVE_LIMIT, got ${String(caught)}`);
  assert.equal(caught.code, "E_ARCHIVE_LIMIT", caught.message);
  assert.match(caught.message, new RegExp(`the ${key} limit`));
  return caught;
}

async function decodeOk(archive: Uint8Array, decode: "zip" | "wbn", opts: { prop?: DecodeLimits; option?: DecodeLimits } = {}): Promise<string[]> {
  let names: string[] = [];
  await withDir(async (dir) => {
    await writeFile(join(dir, `in.${decode}`), archive);
    const node: Descriptor = { tag: "dir", props: { name: "out", src: `in.${decode}`, decode, ...(opts.prop ? { decodeLimits: opts.prop } : {}) }, children: [] };
    const [resolved] = await resolve([node], { cwd: dir, decodeLimits: opts.option });
    names = (resolved.children as Descriptor[]).map((c) => c.props.name as string);
  });
  return names;
}

// --- Defaults ---------------------------------------------------------------

test("default limits are documented values and E_ARCHIVE_LIMIT is exit 1", () => {
  assert.deepEqual({ ...DEFAULT_DECODE_LIMITS }, { maxBytes: 1024 * MiB, maxEntries: 100_000, maxEntryBytes: 256 * MiB, maxRatio: 100 });
  assert.equal(RATIO_GRACE_BYTES, MiB);
  assert.equal(ERROR_CODES.E_ARCHIVE_LIMIT.exitCode, 1);
});

// --- zip --------------------------------------------------------------------

test("zip bomb: 300 MiB of zeros in one entry is stopped by the default ratio limit, early", async () => {
  const bomb = deflatedZeros(300 * MiB);
  assert.ok(bomb.length < 1 * MiB, `bomb is ${bomb.length} bytes`);
  const archive = zipOf([{ name: "zeros.bin", data: bomb, method: 8, declared: 300 * MiB }]);
  // Declared honestly, it's over the per-entry limit before anything is read.
  const declared = await expectLimit(archive, "zip", "maxEntryBytes");
  assert.match(declared.message, /declares 300 MiB/);

  // Declared as 1 KiB (a lie), it's stopped while inflating, by the ratio.
  const lying = zipOf([{ name: "zeros.bin", data: bomb, method: 8, declared: 1024 }]);
  const error = await expectLimit(lying, "zip", "maxRatio");
  assert.match(error.message, /entry "zeros\.bin" inflates/);

  // ...and inflation stopped within one step of the grace size, not at 300 MiB.
  const [entry] = readZipEntries(lying);
  const meter = new DecodeMeter(effectiveDecodeLimits(undefined, undefined), "zip", "test");
  meter.entry(entry.name);
  let peak = 0;
  assert.throws(() => entry.read((produced, consumed) => {
    peak = produced;
    meter.progress(produced, consumed);
  }), (e: unknown) => e instanceof FileableError && e.code === "E_ARCHIVE_LIMIT");
  assert.ok(peak < RATIO_GRACE_BYTES + 32 * MiB, `stopped after ${peak} bytes`);
});

test("zip: an entry whose declared size lies is stopped at maxEntryBytes while inflating", async () => {
  const data = deflatedZeros(16 * MiB);
  const archive = zipOf([{ name: "big.bin", data, method: 8, declared: 10 }]);
  const error = await expectLimit(archive, "zip", "maxEntryBytes", { prop: { maxEntryBytes: 4 * MiB, maxRatio: Infinity } });
  assert.match(error.message, /inflates past 4 MiB/);
  // A stored entry over the limit too.
  const stored = zipOf([{ name: "stored.bin", data: new Uint8Array(2 * MiB), method: 0, declared: 0 }]);
  await expectLimit(stored, "zip", "maxEntryBytes", { option: { maxEntryBytes: MiB } });
});

test("zip: overlapping entries (one compressed stream, many names) are stopped at maxBytes", async () => {
  const data = deflatedZeros(8 * MiB);
  const members: Member[] = Array.from({ length: 200 }, (_, i) => ({ name: `copy${i}.bin`, data, method: 8 as const, declared: 0, shared: "zeros" }));
  const archive = zipOf(members);
  assert.ok(archive.length < 64 * 1024, `archive is ${archive.length} bytes for 1.6 GiB of output`);
  const error = await expectLimit(archive, "zip", "maxBytes", { option: { maxRatio: Infinity, maxBytes: 64 * MiB } });
  assert.match(error.message, /inflates past 64 MiB/);
  // Honest declared sizes are refused before reading anything.
  const honest = zipOf(members.map((m) => ({ ...m, declared: 8 * MiB })));
  const declared = await expectLimit(honest, "zip", "maxBytes", { option: { maxRatio: Infinity, maxBytes: 64 * MiB } });
  assert.match(declared.message, /declare more than 64 MiB/);
});

test("zip: more entries than maxEntries is refused before any entry is read (default 100,000)", async () => {
  const empty = (i: number): Member => ({ name: `f${i}`, data: new Uint8Array(0), method: 0, declared: 0 });
  const over = zipOf(Array.from({ length: 100_001 }, (_, i) => empty(i)), { zip64: true });
  const error = await expectLimit(over, "zip", "maxEntries");
  assert.match(error.message, /has 100001 entries/);
  const atLimit = zipOf(Array.from({ length: 100_000 }, (_, i) => empty(i)), { zip64: true });
  assert.equal((await decodeOk(atLimit, "zip")).length, 100_000);
  const small = zipOf([empty(1), empty(2), empty(3)]);
  await expectLimit(small, "zip", "maxEntries", { option: { maxEntries: 2 } });
});

test("zip: an archive exactly at every limit decodes", async () => {
  const data = deflatedZeros(2 * MiB);
  const archive = zipOf([
    { name: "a.bin", data, method: 8, declared: 2 * MiB },
    { name: "b.txt", data: strToU8("hello"), method: 0, declared: 5 },
  ]);
  const names = await decodeOk(archive, "zip", { option: { maxBytes: 2 * MiB + 5, maxEntries: 2, maxEntryBytes: 2 * MiB, maxRatio: Infinity } });
  assert.deepEqual(names, ["a.bin", "b.txt"]);
});

test("zip: small, very compressible files are not refused for their ratio (1 MiB grace)", async () => {
  const data = deflatedZeros(MiB);
  assert.deepEqual(await decodeOk(zipOf([{ name: "z", data, method: 8, declared: MiB }]), "zip"), ["z"]);
});

// --- wbn --------------------------------------------------------------------

test("wbn bomb: a bundle of zeros is stopped by the default ratio limit while gunzipping", async () => {
  const archive = wbnOf({ "zeros.bin": new Uint8Array(32 * MiB) });
  assert.ok(archive.length < 128 * 1024);
  const error = await expectLimit(archive, "wbn", "maxRatio");
  assert.match(error.message, /the bundle inflates past/);
});

test("wbn: maxBytes, maxEntries and maxEntryBytes", async () => {
  const archive = wbnOf({ "a.bin": new Uint8Array(4 * MiB), "b.bin": new Uint8Array(4 * MiB), "c.txt": strToU8("c") });
  await expectLimit(archive, "wbn", "maxBytes", { option: { maxBytes: 6 * MiB, maxRatio: Infinity } });
  await expectLimit(archive, "wbn", "maxEntries", { option: { maxRatio: Infinity }, prop: { maxEntries: 2 } });
  await expectLimit(archive, "wbn", "maxEntryBytes", { prop: { maxEntryBytes: 2 * MiB, maxRatio: Infinity } });
  assert.deepEqual((await decodeOk(archive, "wbn", { prop: { maxRatio: Infinity } })).sort(), ["a.bin", "b.bin", "c.txt"]);
});

// --- Configuration ----------------------------------------------------------

test("the <Dir decodeLimits> prop wins over the render option, per key", async () => {
  const archive = zipOf([{ name: "a", data: new Uint8Array(10), method: 0, declared: 10 }, { name: "b", data: new Uint8Array(10), method: 0, declared: 10 }]);
  await expectLimit(archive, "zip", "maxEntries", { option: { maxEntries: 5 }, prop: { maxEntries: 1 } });
  assert.deepEqual(await decodeOk(archive, "zip", { option: { maxEntries: 1 }, prop: { maxEntries: 2 } }), ["a", "b"]);
  // A key the prop doesn't set still comes from the option.
  await expectLimit(archive, "zip", "maxBytes", { option: { maxBytes: 15 }, prop: { maxEntries: 2 } });
});

test("invalid limits fail loudly with the code of where they came from", async () => {
  const node = (decodeLimits: unknown): Descriptor => ({ tag: "dir", props: { name: "x", src: "in.zip", decode: "zip", decodeLimits }, children: [] });
  await withDir(async (dir) => {
    await writeFile(join(dir, "in.zip"), zipOf([]));
    for (const bad of [{ maxBytes: 0 }, { maxBytes: -1 }, { maxEntries: 1.5 }, { maxRatio: "100" }, { maxbytes: 1 }, 5, [1]]) {
      await assert.rejects(() => resolve([node(bad)], { cwd: dir }), (e: unknown) => e instanceof FileableError && e.code === "E_INVALID_PROP", JSON.stringify(bad));
      await assert.rejects(() => resolve([node(undefined)], { cwd: dir, decodeLimits: bad as DecodeLimits }), (e: unknown) => e instanceof FileableError && e.code === "E_INVALID_OPTION");
    }
    await resolve([node({ maxBytes: Infinity, maxRatio: 0.5 })], { cwd: dir });
  });
  assert.throws(() => validateManifest({ template: "t.js", decodeLimits: { maxEntries: 0 } }, "m"), (e: unknown) => e instanceof FileableError && e.code === "E_MANIFEST");
  assert.throws(() => validateManifest({ template: "t.js", decodeLimits: { nope: 1 } }, "m"), (e: unknown) => e instanceof FileableError && e.code === "E_MANIFEST");
  assert.deepEqual(validateManifest({ template: "t.js", decodeLimits: { maxBytes: 10 } }, "m").decodeLimits, { maxBytes: 10 });
});

interface Run {
  code: number;
  events: Array<Record<string, unknown>>;
  stderr: string;
}

function runCli(args: string[], cwd: string): Promise<Run> {
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => done({ code: code ?? -1, stderr, events: stdout.split("\n").filter(Boolean).map((l) => JSON.parse(l)) }));
  });
}

test("CLI flags and the manifest's decodeLimits configure the limits; E_ARCHIVE_LIMIT exits 1", async () => {
  await withDir(async (dir) => {
    const project = join(dir, "proj");
    await mkdir(project);
    await writeFile(join(project, "in.zip"), zipOf([{ name: "a.bin", data: new Uint8Array(3 * 1024), method: 0, declared: 3 * 1024 }]));
    await writeFile(
      join(project, "template.ts"),
      `import { dir } from "@johnhenry/fileable";\nexport default () => dir("out", [], { src: "in.zip", decode: "zip" });\n`,
    );
    const base = { template: "template.ts", outDir: "dist", cwd: "." };
    await writeFile(join(project, "fileable.config.json"), JSON.stringify({ ...base, decodeLimits: { maxEntryBytes: 1024 } }));

    const fromManifest = await runCli(["build", "--project", project, "--json"], project);
    assert.equal(fromManifest.code, 1, fromManifest.stderr);
    const error = fromManifest.events.find((e) => e.event === "error")!;
    assert.equal(error.code, "E_ARCHIVE_LIMIT");
    assert.match(String(error.message), /--max-entry-bytes/);

    // A flag overrides the manifest, per key; K/M/G suffixes are binary.
    const raised = await runCli(["build", "--project", project, "--json", "--max-entry-bytes", "4K"], project);
    assert.equal(raised.code, 0, raised.stderr);
    assert.equal((await readFile(join(project, "dist/out/a.bin"))).length, 3 * 1024);

    const lowered = await runCli(["build", "--project", project, "--json", "--no-cache", "--max-entry-bytes", "4K", "--max-decoded-bytes", "2K"], project);
    assert.equal(lowered.events.find((e) => e.event === "error")?.code, "E_ARCHIVE_LIMIT");
    const entries = await runCli(["build", "--project", project, "--json", "--no-cache", "--max-entry-bytes", "1M", "--max-decoded-entries", "1", "--max-compression-ratio", "2.5"], project);
    assert.equal(entries.code, 0, entries.stderr);

    for (const [flag, value] of [["--max-decoded-bytes", "0"], ["--max-decoded-entries", "2K"], ["--max-compression-ratio", "1M"], ["--max-entry-bytes", "lots"]]) {
      const bad = await runCli(["build", "--project", project, "--json", flag, value], project);
      assert.equal(bad.code, 2, `${flag} ${value}`);
      assert.equal(bad.events.find((e) => e.event === "error")?.code, "E_USAGE");
    }

    await writeFile(join(project, "fileable.config.json"), JSON.stringify({ ...base, decodeLimits: { maxEntryBytes: "1K" } }));
    const badManifest = await runCli(["build", "--project", project, "--json"], project);
    assert.equal(badManifest.code, 2);
    assert.equal(badManifest.events.find((e) => e.event === "error")?.code, "E_MANIFEST");
  });
});
