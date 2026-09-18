import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, lstat, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { render } from "../src/render.js";
import { FileableError } from "../src/types.js";
import type { Descriptor } from "../src/types.js";

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "fileable-test-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("render() writes loose files/dirs to outDir", async () => {
  await withTempDir(async (outDir) => {
    const tree: Descriptor = {
      tag: "dir",
      props: { name: "site" },
      children: [{ tag: "file", props: { name: "index.html" }, children: ["hello"] }],
    };
    await render(tree, { outDir, cache: false });
    const content = await readFile(join(outDir, "site/index.html"), "utf8");
    assert.equal(content, "hello");
  });
});

test("render() skips unchanged artifacts on a second run via .fileable-lock.json", async () => {
  await withTempDir(async (outDir) => {
    const tree = (): Descriptor => ({ tag: "file", props: { name: "a.txt" }, children: ["same content"] });
    const first = await render(tree(), { outDir });
    assert.ok(first.written.includes("a.txt"));
    const second = await render(tree(), { outDir });
    assert.ok(second.skipped.includes("a.txt"));
    assert.equal(second.written.includes("a.txt"), false);
  });
});

test("render() writes a real symlink for a loose target", async () => {
  await withTempDir(async (outDir) => {
    const target: Descriptor = { tag: "file", props: { name: "hello.html" }, children: ["HELLO"] };
    const link: Descriptor = { tag: "file", props: { name: "latest", symlink: target }, children: [] };
    const site: Descriptor = { tag: "dir", props: { name: "site" }, children: [target, link] };
    await render(site, { outDir, cache: false });
    const info = await lstat(join(outDir, "site/latest"));
    assert.ok(info.isSymbolicLink());
  });
});

test("render() removes files matched by <rm target>", async () => {
  await withTempDir(async (outDir) => {
    const keep: Descriptor = { tag: "file", props: { name: "keep.txt" }, children: ["keep"] };
    const stale: Descriptor = { tag: "file", props: { name: "stale.draft.html" }, children: ["stale"] };
    const site: Descriptor = { tag: "dir", props: { name: "site" }, children: [keep, stale] };
    await render(site, { outDir, cache: false });
    const removeTree: Descriptor = {
      tag: "dir",
      props: { name: "site" },
      children: [keep, { tag: "rm", props: { target: "*.draft.html" }, children: [] }],
    };
    const result = await render(removeTree, { outDir, cache: false });
    assert.ok(result.removed.includes("site/stale.draft.html"));
    await assert.rejects(() => stat(join(outDir, "site/stale.draft.html")));
    const keptContent = await readFile(join(outDir, "site/keep.txt"), "utf8");
    assert.equal(keptContent, "keep");
  });
});

test("<rm target=\"!negated\"> removes everything except the negated pattern, scoped to its own dir", async () => {
  await withTempDir(async (outDir) => {
    const keepImportant: Descriptor = { tag: "file", props: { name: "keep.important.txt" }, children: ["keep"] };
    const a: Descriptor = { tag: "file", props: { name: "a.txt" }, children: ["a"] };
    const b: Descriptor = { tag: "file", props: { name: "b.txt" }, children: ["b"] };
    // Same filename OUTSIDE "site" -- must survive, since negation is scoped
    // to the <rm>'s own directory context, not the whole outDir.
    const outsideFile: Descriptor = { tag: "file", props: { name: "a.txt" }, children: ["outside, keep me"] };

    const site: Descriptor = { tag: "dir", props: { name: "site" }, children: [keepImportant, a, b] };
    await render({ tag: "dir", props: { name: "top" }, children: [site, outsideFile] }, { outDir, cache: false });
    await stat(join(outDir, "top/site/a.txt"));

    const rmNode: Descriptor = { tag: "rm", props: { target: "!*.important.txt" }, children: [] };
    const siteAfterRm: Descriptor = { tag: "dir", props: { name: "site" }, children: [keepImportant, rmNode] };
    const result = await render(
      { tag: "dir", props: { name: "top" }, children: [siteAfterRm, outsideFile] },
      { outDir, cache: false },
    );
    assert.ok(result.removed.includes("top/site/a.txt"));
    assert.ok(result.removed.includes("top/site/b.txt"));
    await assert.rejects(() => stat(join(outDir, "top/site/a.txt")));
    await assert.rejects(() => stat(join(outDir, "top/site/b.txt")));
    assert.equal(await readFile(join(outDir, "top/site/keep.important.txt"), "utf8"), "keep");
    assert.equal(await readFile(join(outDir, "top/a.txt"), "utf8"), "outside, keep me");
  });
});

test("render() applies `mode`, including on a rewrite where only mode changed", { skip: process.platform === "win32" }, async () => {
  await withTempDir(async (outDir) => {
    const build = (mode: string): Descriptor => ({ tag: "file", props: { name: "run.sh", mode }, children: ["#!/bin/sh"] });

    await render(build("0644"), { outDir });
    assert.equal((await stat(join(outDir, "run.sh"))).mode & 0o777, 0o644);

    // Same content, different mode: the hash must still change (SS4.4) so
    // Write actually re-chmods it -- `fs.writeFile`'s own `mode` option is a
    // no-op on an existing file, so this exercises the explicit chmod path.
    const result = await render(build("0755"), { outDir });
    assert.ok(result.written.includes("run.sh"));
    assert.equal((await stat(join(outDir, "run.sh"))).mode & 0o777, 0o755);
  });
});

test("render() single concatenated file from a <dir> nested in a <file>", async () => {
  await withTempDir(async (outDir) => {
    const a: Descriptor = { tag: "file", props: { name: "a.html" }, children: ["A"] };
    const b: Descriptor = { tag: "file", props: { name: "b.html" }, children: ["B"] };
    const dir: Descriptor = { tag: "dir", props: { name: "docs" }, children: [a, b] };
    const single: Descriptor = { tag: "file", props: { name: "docs-single-page.html" }, children: [dir] };
    await render(single, { outDir, cache: false });
    const content = await readFile(join(outDir, "docs-single-page.html"), "utf8");
    assert.equal(content, "AB");
    await assert.rejects(() => stat(join(outDir, "docs/a.html")));
  });
});

test("render() with <dir from> filling a folder from nested source dirs keeps both same-basename files, not a silent collision", async () => {
  await withTempDir(async (outDir) => {
    const fixtures = join(process.cwd(), "test/fixtures");
    const site: Descriptor = { tag: "dir", props: { name: "out" }, children: [{ tag: "dir", props: { name: "assets", from: "nested-assets/**/*" }, children: [] }] };
    await render(site, { outDir, cwd: fixtures, cache: false });
    assert.equal(await readFile(join(outDir, "out/assets/en/index.html"), "utf8"), "english\n");
    assert.equal(await readFile(join(outDir, "out/assets/fr/index.html"), "utf8"), "french\n");
    assert.equal(await readFile(join(outDir, "out/assets/img/logo.png"), "utf8"), "logo bytes\n");
    assert.equal(await readFile(join(outDir, "out/assets/css/style.css"), "utf8"), "body { color: teal; }\n");
  });
});

test("render() throws when two artifacts resolve to the same output path", async () => {
  await withTempDir(async (outDir) => {
    const a: Descriptor = { tag: "file", props: { name: "same.txt" }, children: ["A"] };
    const b: Descriptor = { tag: "file", props: { name: "same.txt" }, children: ["B"] };
    const site: Descriptor = { tag: "dir", props: { name: "site" }, children: [a, b] };
    await assert.rejects(() => render(site, { outDir, cache: false }), FileableError);
  });
});

test("onConflict=\"error\" refuses to overwrite a file that already exists from outside this build", async () => {
  await withTempDir(async (outDir) => {
    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, "existing.txt"), "pre-existing content");
    const file: Descriptor = { tag: "file", props: { name: "existing.txt", onConflict: "error" }, children: ["new content"] };
    await assert.rejects(() => render(file, { outDir, cache: false }), FileableError);
    assert.equal(await readFile(join(outDir, "existing.txt"), "utf8"), "pre-existing content");
  });
});

test("onConflict=\"append\" adds to existing content instead of replacing it", async () => {
  await withTempDir(async (outDir) => {
    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, "log.txt"), "line 1\n");
    const file: Descriptor = { tag: "file", props: { name: "log.txt", onConflict: "append" }, children: ["line 2\n"] };
    await render(file, { outDir, cache: false });
    assert.equal(await readFile(join(outDir, "log.txt"), "utf8"), "line 1\nline 2\n");
  });
});

test("onConflict=\"append\" on a path that doesn't exist yet just writes normally", async () => {
  await withTempDir(async (outDir) => {
    const file: Descriptor = { tag: "file", props: { name: "new.txt", onConflict: "append" }, children: ["first content"] };
    await render(file, { outDir, cache: false });
    assert.equal(await readFile(join(outDir, "new.txt"), "utf8"), "first content");
  });
});

test("onConflict defaults to \"replace\" (today's behavior, unconditional overwrite)", async () => {
  await withTempDir(async (outDir) => {
    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, "existing.txt"), "old content");
    const file: Descriptor = { tag: "file", props: { name: "existing.txt" }, children: ["new content"] };
    await render(file, { outDir, cache: false });
    assert.equal(await readFile(join(outDir, "existing.txt"), "utf8"), "new content");
  });
});

test("the same src partial reused across two independent pages resolves each page's link()s independently", async () => {
  await withTempDir(async (outDir) => {
    const fixtures = join(process.cwd(), "test/fixtures");
    const pageA: Descriptor = { tag: "file", props: { name: "a.html", src: "self-linking-partial.js" }, children: [] };
    const pageB: Descriptor = { tag: "file", props: { name: "b.html", src: "self-linking-partial.js" }, children: [] };
    await render({ tag: "dir", props: { name: "site" }, children: [pageA, pageB] }, { outDir, cwd: fixtures, cache: false });

    for (const file of ["a.html", "b.html"]) {
      const content = await readFile(join(outDir, "site", file), "utf8");
      const anchorId = /<span id="([^"]+)">/.exec(content)?.[1];
      assert.ok(anchorId, `${file} should have an anchor span`);
      assert.ok(content.includes(`ref:#${anchorId}`), `${file}'s link should point at its own anchor`);
    }
  });
});
