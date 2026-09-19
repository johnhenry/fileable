import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { render } from "../src/render.js";
import type { Descriptor } from "../src/types.js";

test("as=\"archive\" produces a .zip with the same tree inside it", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "fileable-archive-"));
  try {
    const a: Descriptor = { tag: "file", props: { name: "a.txt" }, children: ["A"] };
    const sub: Descriptor = { tag: "dir", props: { name: "sub" }, children: [
      { tag: "file", props: { name: "b.txt" }, children: ["B"] },
    ] };
    const docs: Descriptor = { tag: "dir", props: { name: "docs", as: "archive" }, children: [a, sub] };
    await render(docs, { outDir, cache: false });

    const zipBuffer = await readFile(join(outDir, "docs.zip"));
    const entries = unzipSync(new Uint8Array(zipBuffer));
    assert.equal(strFromU8(entries["a.txt"]), "A");
    assert.equal(strFromU8(entries["sub/b.txt"]), "B");
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("sibling archives sharing a relative path (e.g. both have index.html) cache independently", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "fileable-archive-collision-"));
  try {
    const build = (docsText: string, assetsText: string): Descriptor => ({
      tag: "dir",
      props: { name: "site" },
      children: [
        {
          tag: "dir",
          props: { name: "docs", as: "archive" },
          children: [{ tag: "file", props: { name: "index.html" }, children: [docsText] }],
        },
        {
          tag: "dir",
          props: { name: "assets", as: "archive" },
          children: [{ tag: "file", props: { name: "index.html" }, children: [assetsText] }],
        },
      ],
    });

    await render(build("DOCS v1", "ASSETS v1"), { outDir });
    const docsZip = unzipSync(new Uint8Array(await readFile(join(outDir, "site/docs.zip"))));
    const assetsZip = unzipSync(new Uint8Array(await readFile(join(outDir, "site/assets.zip"))));
    assert.equal(strFromU8(docsZip["index.html"]), "DOCS v1");
    assert.equal(strFromU8(assetsZip["index.html"]), "ASSETS v1");

    // Both unchanged -> both skipped (a lock-key collision would make one
    // archive's presence in the lock file mask the other's).
    const second = await render(build("DOCS v1", "ASSETS v1"), { outDir });
    assert.ok(second.skipped.includes("site/docs.zip"));
    assert.ok(second.skipped.includes("site/assets.zip"));

    // Only "docs" changes -> only "docs.zip" should be rewritten.
    const third = await render(build("DOCS v2", "ASSETS v1"), { outDir });
    assert.ok(third.written.includes("site/docs.zip"));
    assert.ok(third.skipped.includes("site/assets.zip"));
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("an unchanged archive is skipped on rebuild; a changed one is rewritten", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "fileable-archive-cache-"));
  try {
    const build = (text: string): Descriptor => ({
      tag: "dir",
      props: { name: "docs", as: "archive" },
      children: [{ tag: "file", props: { name: "a.txt" }, children: [text] }],
    });
    const first = await render(build("v1"), { outDir });
    assert.ok(first.written.includes("docs.zip"));
    const second = await render(build("v1"), { outDir });
    assert.ok(second.skipped.includes("docs.zip"));
    const third = await render(build("v2"), { outDir });
    assert.ok(third.written.includes("docs.zip"));
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("an archive whose hash is unchanged but whose .zip was deleted by hand gets rewritten, not skipped", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "fileable-archive-cache-"));
  try {
    const build = (): Descriptor => ({
      tag: "dir",
      props: { name: "docs", as: "archive" },
      children: [{ tag: "file", props: { name: "a.txt" }, children: ["v1"] }],
    });
    const first = await render(build(), { outDir });
    assert.ok(first.written.includes("docs.zip"));

    await rm(join(outDir, "docs.zip"));
    const second = await render(build(), { outDir });
    assert.ok(second.written.includes("docs.zip"));
    assert.equal(second.skipped.includes("docs.zip"), false);
    await stat(join(outDir, "docs.zip"));
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});
