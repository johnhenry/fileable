import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { createRouter, fromArchive, fromFiles, toArchive } from "@johnhenry/packfile";
import { toWebBundle, createWebBundleRouter } from "@johnhenry/packfile/web-bundle";
import * as wbn from "wbn";
import { gunzipSync, gzipSync } from "node:zlib";
import { render } from "../src/render.js";
import { resolve } from "../src/resolve.js";
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

/**
 * #20: file names with characters that mean something in a URL. Before the
 * fix, `#` made the render throw, and packfile dropped `?` and `%` names
 * (`query-or-fragment`, `malformed-encoding`); fileable's own decode returned
 * spaces and non-ASCII still percent-encoded. Compared against the tree's
 * own names rather than a loose render, because `?` is not a valid file name
 * on Windows.
 */
const AWKWARD: Record<string, string> = {
  "a#b.txt": "hash",
  "q?x.txt": "query",
  "100%.txt": "percent",
  "%41.txt": "looks-encoded",
  "a b.txt": "space",
  "a@b+c&d=e.txt": "reserved",
  "ü.txt": "non-ascii",
  "dir with space/x%y#z?.html": "<p>nested</p>",
};

function awkwardTree(): Descriptor {
  const top: Descriptor[] = [];
  const nested: Descriptor[] = [];
  for (const [path, body] of Object.entries(AWKWARD)) {
    const parts = path.split("/");
    const file: Descriptor = { tag: "file", props: { name: parts.at(-1)! }, children: [body] };
    (parts.length > 1 ? nested : top).push(file);
  }
  return {
    tag: "dir",
    props: { name: "site", encode: "wbn" },
    children: [...top, { tag: "dir", props: { name: "dir with space" }, children: nested }],
  };
}

async function renderAwkward(): Promise<{ dir: string; archive: Buffer }> {
  const dir = await mkdtemp(join(tmpdir(), "fileable-packfile-interop-awkward-"));
  await render(awkwardTree(), { outDir: dir, cache: false });
  return { dir, archive: await readFile(join(dir, "site.wbn")) };
}

test('encode="wbn" encodes each path segment like packfile, so #, ? and % names survive (#20)', async () => {
  const { dir, archive } = await renderAwkward();
  try {
    const urls = new wbn.Bundle(new Uint8Array(gunzipSync(archive))).urls;
    const expected = Object.keys(AWKWARD).map((p) =>
      new URL(p.split("/").map(encodeURIComponent).join("/"), "https://packfile.invalid/").href,
    );
    assert.deepEqual([...urls].sort(), expected.sort());

    const skipped: unknown[] = [];
    const map = await fromArchive(archive, { onSkip: (s: unknown) => skipped.push(s) });
    assert.deepEqual(skipped, []);
    assert.deepEqual([...map.keys()].sort(), Object.keys(AWKWARD).sort());
    for (const [path, body] of Object.entries(AWKWARD)) {
      assert.equal(Buffer.from(map.get(path)!.data).toString("utf8"), body, path);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("packfile createRouter() and createWebBundleRouter() serve the awkward names by request URL (#20, johnhenry/packfile#35)", async () => {
  const { dir, archive } = await renderAwkward();
  try {
    const router = createRouter(await fromArchive(archive));
    const bundle = new wbn.Bundle(new Uint8Array(gunzipSync(archive)));
    const bundleRouter = createWebBundleRouter(bundle, { baseURL: "https://packfile.invalid/" });
    for (const [path, body] of Object.entries(AWKWARD)) {
      const href = `https://example.test/${path.split("/").map(encodeURIComponent).join("/")}`;
      for (const [label, serve] of [["createRouter", router], ["createWebBundleRouter", bundleRouter]] as const) {
        const res = await serve(new Request(href));
        assert.equal(res.status, 200, `${label} ${path}`);
        assert.equal(await res.text(), body, `${label} ${path}`);
      }
      // A string input is a decoded path for both routers.
      assert.equal(await (await router(`/${path}`)).text(), body);
      assert.equal(await (await bundleRouter(`/${path}`)).text(), body);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('<Dir src decode="wbn"> reads the awkward names back as the same names, from fileable and from packfile archives (#20)', async () => {
  const { dir } = await renderAwkward();
  try {
    const packfileArchive = await toArchive(await fromFiles(AWKWARD));
    await writeFile(join(dir, "packfile.wbn"), packfileArchive);
    for (const src of ["site.wbn", "packfile.wbn"]) {
      const [decoded] = await resolve([{ tag: "dir", props: { name: "out", src, decode: "wbn" }, children: [] }], { cwd: dir });
      const got = Object.fromEntries(
        (decoded.children as Descriptor[]).map((c) => [
          c.props.name as string,
          (c.props as { __resolvedContent?: string }).__resolvedContent,
        ]),
      );
      assert.deepEqual(got, AWKWARD, src);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
