import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzip } from "node:zlib";
import { promisify } from "node:util";
import * as wbn from "wbn";
import { render } from "../src/render.js";
import type { Descriptor } from "../src/types.js";

const gunzipAsync = promisify(gunzip);
const ARCHIVE_BASE_URL = "https://packfile.invalid/";

/**
 * Reads a `<Dir encode="wbn">` output back via `wbn`'s own `Bundle` parser
 * directly -- the same real, Google-maintained package `write/wbn.ts`
 * itself builds with -- not a hand-rolled decoder. Proves real interop with
 * the actual Web Bundle format, not just internal round-tripping.
 */
async function readWbnArchive(buffer: Buffer): Promise<Map<string, Uint8Array>> {
  const decompressed = await gunzipAsync(buffer);
  const bundle = new wbn.Bundle(new Uint8Array(decompressed));
  const files = new Map<string, Uint8Array>();
  for (const url of bundle.urls) {
    const relative = url.startsWith(ARCHIVE_BASE_URL) ? url.slice(ARCHIVE_BASE_URL.length) : url;
    files.set(relative, bundle.getResponse(url).body);
  }
  return files;
}

test('encode="wbn" produces a .wbn readable back by wbn\'s own Bundle parser', async () => {
  const outDir = await mkdtemp(join(tmpdir(), "fileable-packfile-"));
  try {
    const a: Descriptor = { tag: "file", props: { name: "a.txt" }, children: ["A"] };
    const sub: Descriptor = {
      tag: "dir",
      props: { name: "sub" },
      children: [{ tag: "file", props: { name: "b.txt" }, children: ["B"] }],
    };
    const docs: Descriptor = { tag: "dir", props: { name: "docs", encode: "wbn" }, children: [a, sub] };
    await render(docs, { outDir, cache: false });

    const buffer = await readFile(join(outDir, "docs.wbn"));
    const files = await readWbnArchive(buffer);
    assert.equal(files.size, 2);
    assert.equal(new TextDecoder().decode(files.get("a.txt")!), "A");
    assert.equal(new TextDecoder().decode(files.get("sub/b.txt")!), "B");
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("a binary file round-trips byte-exact through a packfile", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "fileable-packfile-binary-"));
  try {
    const logoPath = join(process.cwd(), "test/fixtures/logo.png");
    const original = await readFile(logoPath);
    const tree: Descriptor = {
      tag: "dir",
      props: { name: "assets", encode: "wbn" },
      children: [{ tag: "file", props: { name: "logo.png", src: logoPath }, children: [] }],
    };
    await render(tree, { outDir, cache: false });

    const buffer = await readFile(join(outDir, "assets.wbn"));
    const files = await readWbnArchive(buffer);
    const data = files.get("logo.png")!;
    assert.ok(Buffer.from(data).equals(original));
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("an empty <Dir> inside a packfile contributes no entry (Web Bundles have no directory concept)", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "fileable-packfile-emptydir-"));
  try {
    const tree: Descriptor = {
      tag: "dir",
      props: { name: "site", encode: "wbn" },
      children: [
        { tag: "dir", props: { name: "empty" }, children: [] },
        { tag: "file", props: { name: "a.txt" }, children: ["A"] },
      ],
    };
    await render(tree, { outDir, cache: false });

    const buffer = await readFile(join(outDir, "site.wbn"));
    const files = await readWbnArchive(buffer);
    assert.equal(files.size, 1);
    assert.ok(files.has("a.txt"));
    assert.equal(files.has("empty"), false);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("each entry's Content-Type is inferred from its extension", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "fileable-packfile-mime-"));
  try {
    const tree: Descriptor = {
      tag: "dir",
      props: { name: "site", encode: "wbn" },
      children: [
        { tag: "file", props: { name: "index.html" }, children: ["<h1>Hi</h1>"] },
        { tag: "file", props: { name: "style.css" }, children: ["body{}"] },
        { tag: "file", props: { name: "data.bin" }, children: [] },
      ],
    };
    await render(tree, { outDir, cache: false });

    const buffer = await readFile(join(outDir, "site.wbn"));
    const decompressed = await gunzipAsync(buffer);
    const bundle = new wbn.Bundle(new Uint8Array(decompressed));
    assert.equal(bundle.getResponse(`${ARCHIVE_BASE_URL}index.html`).headers["content-type"], "text/html");
    assert.equal(bundle.getResponse(`${ARCHIVE_BASE_URL}style.css`).headers["content-type"], "text/css");
    assert.equal(bundle.getResponse(`${ARCHIVE_BASE_URL}data.bin`).headers["content-type"], "application/octet-stream");
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("an unchanged packfile is skipped on rebuild; a changed one is rewritten", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "fileable-packfile-cache-"));
  try {
    const build = (text: string): Descriptor => ({
      tag: "dir",
      props: { name: "docs", encode: "wbn" },
      children: [{ tag: "file", props: { name: "a.txt" }, children: [text] }],
    });
    const first = await render(build("v1"), { outDir });
    assert.ok(first.written.includes("docs.wbn"));
    const second = await render(build("v1"), { outDir });
    assert.ok(second.skipped.includes("docs.wbn"));
    const third = await render(build("v2"), { outDir });
    assert.ok(third.written.includes("docs.wbn"));
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("a packfile whose hash is unchanged but whose .wbn was deleted by hand gets rewritten, not skipped", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "fileable-packfile-cache-"));
  try {
    const build = (): Descriptor => ({
      tag: "dir",
      props: { name: "docs", encode: "wbn" },
      children: [{ tag: "file", props: { name: "a.txt" }, children: ["v1"] }],
    });
    const first = await render(build(), { outDir });
    assert.ok(first.written.includes("docs.wbn"));

    await rm(join(outDir, "docs.wbn"));
    const second = await render(build(), { outDir });
    assert.ok(second.written.includes("docs.wbn"));
    assert.equal(second.skipped.includes("docs.wbn"), false);
    await stat(join(outDir, "docs.wbn"));
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});
