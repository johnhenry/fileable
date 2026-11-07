import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { createRouter, fromArchive, fromFiles } from "@johnhenry/packfile";
import { toWebBundle } from "@johnhenry/packfile/web-bundle";
import { gzipSync } from "node:zlib";
import { render } from "../src/render.js";
import type { Descriptor } from "../src/types.js";

/**
 * README `## Family` claims `<Dir encode="wbn">` output is directly readable
 * by `@johnhenry/packfile`'s own `fromArchive()`/`createRouter()`.
 * `write-wbn.test.ts` only checks the bundle with `wbn` itself; this checks
 * it with packfile (a devDependency only -- fileable never imports it at
 * runtime). See johnhenry/fileable#19.
 */

const BINARY = Uint8Array.from({ length: 256 }, (_, i) => i);
const HTML = "<!doctype html><h1>Hello</h1>";
const CSS = "body { color: red; }";

function site(encode: "wbn" | "loose", overrides: { css?: string } = {}): Descriptor {
  return {
    tag: "dir",
    props: { name: "site", encode },
    children: [
      { tag: "file", props: { name: "index.html" }, children: [HTML] },
      { tag: "file", props: { name: "style.css" }, children: [overrides.css ?? CSS] },
      { tag: "file", props: { name: "bytes.bin", base64: Buffer.from(BINARY).toString("base64") }, children: [] },
      {
        tag: "dir",
        props: { name: "nested" },
        children: [
          {
            tag: "dir",
            props: { name: "deeper" },
            children: [{ tag: "file", props: { name: "page.html" }, children: ["<p>deep</p>"] }],
          },
        ],
      },
    ],
  };
}

/** Recursively reads a loose render into `relative POSIX path -> bytes`. */
async function readTree(root: string): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const full = join(entry.parentPath, entry.name);
    files.set(relative(root, full).split(sep).join("/"), new Uint8Array(await readFile(full)));
  }
  return files;
}

async function renderBoth(looseTree: Descriptor = site("loose")) {
  const wbnDir = await mkdtemp(join(tmpdir(), "fileable-packfile-interop-wbn-"));
  const looseDir = await mkdtemp(join(tmpdir(), "fileable-packfile-interop-loose-"));
  try {
    await render(site("wbn"), { outDir: wbnDir, cache: false });
    await render(looseTree, { outDir: looseDir, cache: false });
    const archive = await readFile(join(wbnDir, "site.wbn"));
    const loose = await readTree(join(looseDir, "site"));
    return { archive, loose };
  } finally {
    await rm(wbnDir, { recursive: true, force: true });
    await rm(looseDir, { recursive: true, force: true });
  }
}

function assertSameFiles(actual: Map<string, { data: Uint8Array }>, expected: Map<string, Uint8Array>) {
  assert.deepEqual([...actual.keys()].sort(), [...expected.keys()].sort());
  for (const [path, bytes] of expected) {
    assert.ok(Buffer.from(actual.get(path)!.data).equals(Buffer.from(bytes)), `bytes differ for ${path}`);
  }
}

test('packfile fromArchive() reads encode="wbn" output as exactly the loose render\'s paths and bytes', async () => {
  const { archive, loose } = await renderBoth();
  // Sanity: the loose render is the tree we think it is.
  assert.deepEqual([...loose.keys()].sort(), ["bytes.bin", "index.html", "nested/deeper/page.html", "style.css"]);
  assert.ok(Buffer.from(loose.get("bytes.bin")!).equals(Buffer.from(BINARY)));

  const map = await fromArchive(archive);
  assertSameFiles(map, loose);
  for (const [, entry] of map) assert.equal(entry.size, entry.data.byteLength);
});

test("the comparison fails against a loose tree with one changed file (mutation check)", async () => {
  const { archive, loose } = await renderBoth(site("loose", { css: "body { color: blue; }" }));
  const map = await fromArchive(archive);
  assert.throws(() => assertSameFiles(map, loose), /bytes differ for style\.css/);
});

test("the archive's paths depend on fileable's base URL matching packfile's (mutation check)", async () => {
  // packfile's fromArchive() silently drops exchanges outside its own base URL,
  // so a writer with a different base would produce an "empty" archive.
  // Prove that is detectable: re-reading uncompressed (wrong options) must throw,
  // and an archive whose entries are under a different base URL yields no files.
  // Its primary URL is packfile's own base: since johnhenry/packfile#22, fromArchive()
  // without a baseURL strips against the primary URL's root, so this stays empty there too.
  const { archive } = await renderBoth();
  await assert.rejects(fromArchive(archive, { compressed: false }));

  const wrongBase = gzipSync(
    toWebBundle(await fromFiles({ "index.html": HTML }), {
      baseURL: "https://not-packfile.invalid/",
      primaryURL: "https://packfile.invalid/",
    }),
  );
  assert.equal((await fromArchive(wrongBase)).size, 0);
});

test('packfile createRouter() serves encode="wbn" output: a page, a nested page, the binary, and a 404', async () => {
  const { archive } = await renderBoth();
  const router = createRouter(await fromArchive(archive));

  const page = await router("/index.html");
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type") ?? "", /^text\/html/);
  assert.equal(await page.text(), HTML);

  const css = await router(new Request("https://example.test/style.css"));
  assert.equal(css.status, 200);
  assert.match(css.headers.get("content-type") ?? "", /^text\/css/);
  assert.equal(await css.text(), CSS);

  const nested = await router("/nested/deeper/page.html");
  assert.equal(nested.status, 200);
  assert.equal(await nested.text(), "<p>deep</p>");

  const bin = await router("/bytes.bin");
  assert.equal(bin.status, 200);
  assert.equal(bin.headers.get("content-length"), "256");
  assert.ok(Buffer.from(await bin.arrayBuffer()).equals(Buffer.from(BINARY)));

  const missing = await router("/missing.html");
  assert.equal(missing.status, 404);
  // Web Bundles have no directory entries, so a directory path is a 404 too.
  assert.equal((await router("/nested")).status, 404);
});
