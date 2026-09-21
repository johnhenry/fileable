import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { render } from "../src/render.js";
import { FileableError } from "../src/types.js";
import type { Descriptor, DeletableFileInfo } from "../src/types.js";

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "fileable-rm-test-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

test('kind: "dir" removes a real directory, recursively', async () => {
  await withTempDir(async (outDir) => {
    await mkdir(join(outDir, "site/sub"), { recursive: true });
    await writeFile(join(outDir, "site/sub/nested.txt"), "x");

    const tree: Descriptor = {
      tag: "dir",
      props: { name: "site" },
      children: [{ tag: "rm", props: { target: "sub", kind: "dir" }, children: [] }],
    };
    const result = await render(tree, { outDir, cache: false });
    assert.ok(result.removed.includes("site/sub"));
    assert.equal(await exists(join(outDir, "site/sub")), false);
  });
});

test('kind: "dir" does NOT match a file with the same glob (default kind: "file" still doesn\'t match dirs either)', async () => {
  await withTempDir(async (outDir) => {
    await mkdir(join(outDir, "site/sub"), { recursive: true });
    await writeFile(join(outDir, "site/plain.txt"), "x");

    const tree: Descriptor = {
      tag: "dir",
      props: { name: "site" },
      children: [{ tag: "rm", props: { target: "*", kind: "dir" }, children: [] }],
    };
    const result = await render(tree, { outDir, cache: false });
    assert.ok(result.removed.includes("site/sub"));
    assert.ok(!result.removed.includes("site/plain.txt"));
    assert.equal(await exists(join(outDir, "site/plain.txt")), true);
  });
});

test('kind: "any" matches both files and directories', async () => {
  await withTempDir(async (outDir) => {
    await mkdir(join(outDir, "site/sub"), { recursive: true });
    await writeFile(join(outDir, "site/plain.txt"), "x");

    const tree: Descriptor = {
      tag: "dir",
      props: { name: "site" },
      children: [{ tag: "rm", props: { target: "*", kind: "any" }, children: [] }],
    };
    const result = await render(tree, { outDir, cache: false });
    assert.ok(result.removed.includes("site/sub"));
    assert.ok(result.removed.includes("site/plain.txt"));
  });
});

test("emptyOnly removes an empty directory but leaves a non-empty one alone", async () => {
  await withTempDir(async (outDir) => {
    await mkdir(join(outDir, "site/empty-dir"), { recursive: true });
    await mkdir(join(outDir, "site/full-dir"), { recursive: true });
    await writeFile(join(outDir, "site/full-dir/keep.txt"), "keep");

    const tree: Descriptor = {
      tag: "dir",
      props: { name: "site" },
      children: [{ tag: "rm", props: { target: "*", kind: "dir", emptyOnly: true }, children: [] }],
    };
    const result = await render(tree, { outDir, cache: false });
    assert.ok(result.removed.includes("site/empty-dir"));
    assert.ok(!result.removed.includes("site/full-dir"));
    assert.equal(await exists(join(outDir, "site/full-dir")), true);
    assert.equal(await readFile(join(outDir, "site/full-dir/keep.txt"), "utf8"), "keep");
  });
});

test('onMissing="ignore" (default): a target matching nothing stays fully silent, same as before this option existed', async () => {
  await withTempDir(async (outDir) => {
    const tree: Descriptor = {
      tag: "dir",
      props: { name: "site" },
      children: [
        { tag: "file", props: { name: "keep.txt" }, children: ["keep"] },
        { tag: "rm", props: { target: "nope-*.txt" }, children: [] },
      ],
    };
    const result = await render(tree, { outDir, cache: false });
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(result.removed, []);
  });
});

test('onMissing="warn": a target matching nothing produces a warning instead of staying silent', async () => {
  await withTempDir(async (outDir) => {
    const tree: Descriptor = {
      tag: "dir",
      props: { name: "site" },
      children: [{ tag: "rm", props: { target: "nope-*.txt", onMissing: "warn" }, children: [] }],
    };
    const result = await render(tree, { outDir, cache: false });
    assert.ok(result.warnings.some((w) => w.includes("nope-*.txt") && w.includes("matched nothing")));
  });
});

test('onMissing="error": a target matching nothing fails the whole build', async () => {
  await withTempDir(async (outDir) => {
    const tree: Descriptor = {
      tag: "dir",
      props: { name: "site" },
      children: [{ tag: "rm", props: { target: "nope-*.txt", onMissing: "error" }, children: [] }],
    };
    await assert.rejects(() => render(tree, { outDir, cache: false }), FileableError);
  });
});

test("onMissing fires when every match was filtered out (kind/emptyOnly), not just when the glob matched literally nothing", async () => {
  await withTempDir(async (outDir) => {
    await mkdir(join(outDir, "site/full-dir"), { recursive: true });
    await writeFile(join(outDir, "site/full-dir/keep.txt"), "keep");

    const tree: Descriptor = {
      tag: "dir",
      props: { name: "site" },
      children: [
        { tag: "rm", props: { target: "*", kind: "dir", emptyOnly: true, onMissing: "error" }, children: [] },
      ],
    };
    // full-dir matches the glob but is filtered out by emptyOnly -- zero
    // *qualifying* matches, same as zero raw matches from onMissing's
    // point of view.
    await assert.rejects(() => render(tree, { outDir, cache: false }), FileableError);
  });
});

test("invalid kind= throws", async () => {
  await withTempDir(async (outDir) => {
    const tree: Descriptor = {
      tag: "dir",
      props: { name: "site" },
      children: [{ tag: "rm", props: { target: "*", kind: "tarball" }, children: [] }],
    };
    await assert.rejects(() => render(tree, { outDir, cache: false }), FileableError);
  });
});

test("invalid onMissing= throws", async () => {
  await withTempDir(async (outDir) => {
    const tree: Descriptor = {
      tag: "dir",
      props: { name: "site" },
      children: [{ tag: "rm", props: { target: "*", onMissing: "crash" }, children: [] }],
    };
    await assert.rejects(() => render(tree, { outDir, cache: false }), FileableError);
  });
});

test("deletable() returning falsy skips the match; returning truthy removes it", async () => {
  await withTempDir(async (outDir) => {
    await mkdir(join(outDir, "site"), { recursive: true });
    await writeFile(join(outDir, "site/keep.txt"), "keep");
    await writeFile(join(outDir, "site/drop.txt"), "drop");

    const tree: Descriptor = {
      tag: "dir",
      props: { name: "site" },
      children: [
        {
          tag: "rm",
          props: {
            target: "*.txt",
            deletable: (_file: DeletableFileInfo | null, ctx: { path: string }) => ctx.path.endsWith("drop.txt"),
          },
          children: [],
        },
      ],
    };

    const result = await render(tree, { outDir, cache: false });
    assert.ok(result.removed.includes("site/drop.txt"));
    assert.ok(!result.removed.includes("site/keep.txt"));
    assert.equal(await exists(join(outDir, "site/drop.txt")), false);
    assert.equal(await exists(join(outDir, "site/keep.txt")), true);
  });
});

test("deletable() receives real stat info for an existing match", async () => {
  await withTempDir(async (outDir) => {
    await mkdir(join(outDir, "site"), { recursive: true });
    await writeFile(join(outDir, "site/a.txt"), "hello");

    let seen: DeletableFileInfo | null | undefined;
    const tree: Descriptor = {
      tag: "dir",
      props: {
        name: "site",
      },
      children: [
        {
          tag: "rm",
          props: {
            target: "a.txt",
            deletable: (file: DeletableFileInfo | null) => {
              seen = file;
              return true;
            },
          },
          children: [],
        },
      ],
    };
    await render(tree, { outDir, cache: false });
    assert.ok(seen);
    assert.equal(seen!.isFile, true);
    assert.equal(seen!.isDirectory, false);
    assert.equal(seen!.size, 5);
    assert.ok(seen!.mtime instanceof Date);
  });
});

test("deletable() receives null when a match no longer exists by the time it's processed", async () => {
  await withTempDir(async (outDir) => {
    await mkdir(join(outDir, "site/sub"), { recursive: true });
    await writeFile(join(outDir, "site/sub/nested.txt"), "x");

    // Confirmed by actually running glob("**") over a real directory tree
    // (see write/loose.ts's own comment): the parent directory sorts before
    // its own children, so removing "sub" recursively -- the moment its
    // match is processed -- makes the already-captured "sub/nested.txt"
    // match stale by the time this <Rm>'s loop gets to it.
    const seenForNested: (DeletableFileInfo | null)[] = [];
    const tree: Descriptor = {
      tag: "dir",
      props: { name: "site" },
      children: [
        {
          tag: "rm",
          props: {
            target: "**",
            kind: "any",
            deletable: (file: DeletableFileInfo | null, ctx: { path: string }) => {
              if (ctx.path.endsWith("nested.txt")) seenForNested.push(file);
              return true;
            },
          },
          children: [],
        },
      ],
    };
    await render(tree, { outDir, cache: false });
    assert.equal(seenForNested.length, 1);
    assert.equal(seenForNested[0], null);
  });
});

test("deletable() throwing aborts the build with a clear FileableError", async () => {
  await withTempDir(async (outDir) => {
    await mkdir(join(outDir, "site"), { recursive: true });
    await writeFile(join(outDir, "site/a.txt"), "x");

    const tree: Descriptor = {
      tag: "dir",
      props: {
        name: "site",
      },
      children: [
        {
          tag: "rm",
          props: {
            target: "a.txt",
            deletable: () => {
              throw new Error("custom policy violation");
            },
          },
          children: [],
        },
      ],
    };
    await assert.rejects(() => render(tree, { outDir, cache: false }), FileableError);
    assert.equal(await exists(join(outDir, "site/a.txt")), true);
  });
});

test('<Rm target="**" kind="any"> never matches the search root itself', async () => {
  await withTempDir(async (outDir) => {
    await mkdir(join(outDir, "site/sub"), { recursive: true });
    await writeFile(join(outDir, "site/sub/a.txt"), "x");

    const tree: Descriptor = {
      tag: "dir",
      props: { name: "site" },
      children: [{ tag: "rm", props: { target: "**", kind: "any" }, children: [] }],
    };
    const result = await render(tree, { outDir, cache: false });
    // Everything INSIDE "site" is gone, but "site" itself (the <Rm>'s own
    // search root) was never a candidate at all.
    assert.ok(result.removed.includes("site/sub"));
    assert.equal(await exists(join(outDir, "site")), true);
    assert.equal(await exists(join(outDir, "site/sub")), false);
  });
});

test("dryRun reports what deletable/kind/emptyOnly would remove without touching disk", async () => {
  await withTempDir(async (outDir) => {
    await mkdir(join(outDir, "site/empty-dir"), { recursive: true });
    await writeFile(join(outDir, "site/a.txt"), "x");

    const tree: Descriptor = {
      tag: "dir",
      props: { name: "site" },
      children: [{ tag: "rm", props: { target: "*", kind: "any" }, children: [] }],
    };
    const result = await render(tree, { outDir, cache: false, dryRun: true });
    assert.ok(result.removed.includes("site/empty-dir"));
    assert.ok(result.removed.includes("site/a.txt"));
    assert.equal(await exists(join(outDir, "site/empty-dir")), true);
    assert.equal(await exists(join(outDir, "site/a.txt")), true);
  });
});
