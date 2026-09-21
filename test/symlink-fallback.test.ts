import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { render } from "../src/render.js";
import type { Descriptor } from "../src/types.js";

function tree(): Descriptor {
  const target: Descriptor = { tag: "file", props: { name: "hello.html" }, children: ["HELLO"] };
  const link: Descriptor = { tag: "file", props: { name: "latest", symlink: target }, children: [] };
  return { tag: "dir", props: { name: "site" }, children: [target, link] };
}

test("loose symlink either creates a real link or degrades to a content copy, but never fails the build", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "fileable-symlink-"));
  try {
    // On POSIX this exercises the normal real-symlink path; on Windows without
    // Developer Mode / elevation it exercises the EPERM catch in
    // src/write/loose.ts. Either way the build must succeed and `latest`
    // must resolve to the target's content.
    const result = await render(tree(), { outDir, cache: false });
    const info = await lstat(join(outDir, "site/latest"));
    if (info.isSymbolicLink()) {
      assert.equal(await readFile(join(outDir, "site/hello.html"), "utf8"), "HELLO");
    } else {
      assert.equal(await readFile(join(outDir, "site/latest"), "utf8"), "HELLO");
      assert.ok(result.warnings.some((w) => w.includes("materialized as a copy")));
    }
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("archive target always degrades symlinks to a copy, with a warning", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "fileable-symlink-archive-"));
  try {
    const target: Descriptor = { tag: "file", props: { name: "hello.html" }, children: ["HELLO"] };
    const link: Descriptor = { tag: "file", props: { name: "latest", symlink: target }, children: [] };
    const site: Descriptor = { tag: "dir", props: { name: "site", encode: "zip" }, children: [target, link] };
    const result = await render(site, { outDir, cache: false });
    assert.ok(result.warnings.some((w) => w.includes("materialized as a copy")));
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("strict:true turns an archive symlink degrade into a thrown error", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "fileable-symlink-strict-"));
  try {
    const target: Descriptor = { tag: "file", props: { name: "hello.html" }, children: ["HELLO"] };
    const link: Descriptor = { tag: "file", props: { name: "latest", symlink: target }, children: [] };
    const site: Descriptor = { tag: "dir", props: { name: "site", encode: "zip" }, children: [target, link] };
    await assert.rejects(() => render(site, { outDir, cache: false, strict: true }));
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});
