import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { zipSync, strToU8 } from "fflate";
import * as wbn from "wbn";
import { render } from "../src/render.js";
import { resolve } from "../src/resolve.js";
import { FileableError } from "../src/types.js";
import type { Descriptor } from "../src/types.js";

const dec = new TextDecoder();

test("<Dir src decode=\"zip\"> round-trips a real fileable-produced .zip", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "fileable-decode-zip-"));
  try {
    const built: Descriptor = {
      tag: "dir",
      props: { name: "site", encode: "zip" },
      children: [
        { tag: "file", props: { name: "index.html" }, children: ["<h1>Hi</h1>"] },
        { tag: "dir", props: { name: "sub" }, children: [{ tag: "file", props: { name: "b.txt" }, children: ["B"] }] },
      ],
    };
    await render(built, { outDir, cache: false });

    const decoded: Descriptor = {
      tag: "dir",
      props: { name: "out", src: "site.zip", decode: "zip" },
      children: [],
    };
    const [resolved] = await resolve([decoded], { cwd: outDir });
    const names = resolved.children.map((c) => (c as Descriptor).props.name).sort();
    assert.deepEqual(names, ["index.html", "sub/b.txt"]);
    const index = resolved.children.find((c) => (c as Descriptor).props.name === "index.html") as Descriptor;
    assert.equal((index.props as { __resolvedContent?: string }).__resolvedContent, "<h1>Hi</h1>");
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("<Dir src decode=\"wbn\"> round-trips a real fileable-produced .wbn", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "fileable-decode-wbn-"));
  try {
    const built: Descriptor = {
      tag: "dir",
      props: { name: "site", encode: "wbn" },
      children: [{ tag: "file", props: { name: "index.html" }, children: ["<h1>Hi</h1>"] }],
    };
    await render(built, { outDir, cache: false });

    const decoded: Descriptor = {
      tag: "dir",
      props: { name: "out", src: "site.wbn", decode: "wbn" },
      children: [],
    };
    const [resolved] = await resolve([decoded], { cwd: outDir });
    assert.equal(resolved.children.length, 1);
    const index = resolved.children[0] as Descriptor;
    assert.equal(index.props.name, "index.html");
    assert.equal((index.props as { __resolvedContent?: string }).__resolvedContent, "<h1>Hi</h1>");
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("decodes a real interop zip built directly via fflate, not just fileable's own output", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "fileable-decode-interop-zip-"));
  try {
    const zipped = zipSync({ "a.txt": strToU8("A"), "nested/b.txt": strToU8("B") });
    await writeFile(join(outDir, "foreign.zip"), zipped);

    const decoded: Descriptor = { tag: "dir", props: { name: "out", src: "foreign.zip", decode: "zip" }, children: [] };
    const [resolved] = await resolve([decoded], { cwd: outDir });
    const names = resolved.children.map((c) => (c as Descriptor).props.name).sort();
    assert.deepEqual(names, ["a.txt", "nested/b.txt"]);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("decodes a real interop .wbn built directly via wbn, not just fileable's own output", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "fileable-decode-interop-wbn-"));
  try {
    const builder = new wbn.BundleBuilder();
    builder.addExchange("https://packfile.invalid/a.txt", 200, { "Content-Type": "text/plain" }, "A");
    builder.setPrimaryURL("https://packfile.invalid/");
    await writeFile(join(outDir, "foreign.wbn"), gzipSync(Buffer.from(builder.createBundle())));

    const decoded: Descriptor = { tag: "dir", props: { name: "out", src: "foreign.wbn", decode: "wbn" }, children: [] };
    const [resolved] = await resolve([decoded], { cwd: outDir });
    assert.equal(resolved.children.length, 1);
    assert.equal((resolved.children[0] as Descriptor).props.name, "a.txt");
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("an explicit child with the same name as a decoded entry overrides it, instead of colliding", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "fileable-decode-override-"));
  try {
    const zipped = zipSync({ "index.html": strToU8("OLD"), "keep.txt": strToU8("KEEP") });
    await writeFile(join(outDir, "site.zip"), zipped);

    const decoded: Descriptor = {
      tag: "dir",
      props: { name: "out", src: "site.zip", decode: "zip" },
      children: [{ tag: "file", props: { name: "index.html" }, children: ["NEW"] }],
    };
    const [resolved] = await resolve([decoded], { cwd: outDir });
    const names = resolved.children.map((c) => (c as Descriptor).props.name).sort();
    assert.deepEqual(names, ["index.html", "keep.txt"]);
    const index = resolved.children.find((c) => (c as Descriptor).props.name === "index.html") as Descriptor;
    // The explicit child wins -- its own content (resolved separately, via
    // its own children array), not the decoded "OLD" bytes.
    assert.equal((index.props as { __resolvedContent?: string }).__resolvedContent, undefined);
    assert.deepEqual(index.children, ["NEW"]);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("an explicit child with a NEW name coexists alongside decoded entries", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "fileable-decode-add-"));
  try {
    const zipped = zipSync({ "a.txt": strToU8("A") });
    await writeFile(join(outDir, "site.zip"), zipped);

    const decoded: Descriptor = {
      tag: "dir",
      props: { name: "out", src: "site.zip", decode: "zip" },
      children: [{ tag: "file", props: { name: "b.txt" }, children: ["B"] }],
    };
    const [resolved] = await resolve([decoded], { cwd: outDir });
    const names = resolved.children.map((c) => (c as Descriptor).props.name).sort();
    assert.deepEqual(names, ["a.txt", "b.txt"]);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("a binary entry round-trips byte-exact through a decoded zip", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "fileable-decode-binary-"));
  try {
    const original = await readFile(join(process.cwd(), "test/fixtures/logo.png"));
    const zipped = zipSync({ "logo.png": new Uint8Array(original) });
    await writeFile(join(outDir, "assets.zip"), zipped);

    const decoded: Descriptor = { tag: "dir", props: { name: "out", src: "assets.zip", decode: "zip" }, children: [] };
    const [resolved] = await resolve([decoded], { cwd: outDir });
    const entry = resolved.children[0] as Descriptor;
    const content = (entry.props as { __resolvedContent?: string | Buffer }).__resolvedContent;
    assert.ok(Buffer.isBuffer(content));
    assert.ok((content as Buffer).equals(original));
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("zip directory entries are skipped, not synthesized as zero-byte Files", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "fileable-decode-dirs-"));
  try {
    const zipped = zipSync({ "sub/": new Uint8Array(0), "sub/a.txt": strToU8("A") });
    await writeFile(join(outDir, "site.zip"), zipped);

    const decoded: Descriptor = { tag: "dir", props: { name: "out", src: "site.zip", decode: "zip" }, children: [] };
    const [resolved] = await resolve([decoded], { cwd: outDir });
    const names = resolved.children.map((c) => (c as Descriptor).props.name);
    assert.deepEqual(names, ["sub/a.txt"]);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("src without decode throws", async () => {
  const node: Descriptor = { tag: "dir", props: { name: "out", src: "site.zip" }, children: [] };
  await assert.rejects(() => resolve([node]), FileableError);
});

test("decode without src throws", async () => {
  const node: Descriptor = { tag: "dir", props: { name: "out", decode: "zip" }, children: [] };
  await assert.rejects(() => resolve([node]), FileableError);
});

test("an invalid decode value throws", async () => {
  const node: Descriptor = { tag: "dir", props: { name: "out", src: "site.zip", decode: "rar" }, children: [] };
  await assert.rejects(() => resolve([node]), FileableError);
});

test("a nonexistent archive file throws a clear FileableError", async () => {
  const node: Descriptor = { tag: "dir", props: { name: "out", src: "nope.zip", decode: "zip" }, children: [] };
  await assert.rejects(() => resolve([node], { cwd: tmpdir() }), FileableError);
});

test("a corrupt archive throws a clear FileableError instead of a raw parser crash", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "fileable-decode-corrupt-"));
  try {
    await writeFile(join(outDir, "bad.zip"), "not a zip file");
    const node: Descriptor = { tag: "dir", props: { name: "out", src: "bad.zip", decode: "zip" }, children: [] };
    await assert.rejects(() => resolve([node], { cwd: outDir }), FileableError);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});
