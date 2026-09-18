import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
