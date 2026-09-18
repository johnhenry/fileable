import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, lstat, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { render } from "../src/render.js";
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
