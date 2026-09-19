import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve } from "../src/resolve.js";
import { drainBuildContext } from "../src/context.js";
import { FileableError } from "../src/types.js";
import type { Descriptor } from "../src/types.js";

const fixtures = join(process.cwd(), "test/fixtures");

test("reads a plain-text src file into __resolvedContent", async () => {
  const node: Descriptor = { tag: "file", props: { name: "out.txt", src: "hello.txt" }, children: [] };
  const [resolved] = await resolve([node], { cwd: fixtures });
  assert.equal((resolved.props as { __resolvedContent?: string }).__resolvedContent, "Hello from a file\n");
});

test("reads a binary src file (PNG) as a byte-exact Buffer, not UTF-8-decoded text", async () => {
  const node: Descriptor = { tag: "file", props: { name: "out.png", src: "logo.png" }, children: [] };
  const [resolved] = await resolve([node], { cwd: fixtures });
  const content = (resolved.props as { __resolvedContent?: string | Buffer }).__resolvedContent;
  assert.ok(Buffer.isBuffer(content));
  const original = await readFile(join(fixtures, "logo.png"));
  assert.ok((content as Buffer).equals(original));
});

test("cmd with binary stdout is preserved byte-exact, not UTF-8-decoded", async () => {
  // `cat` doesn't exist on Windows -- shell out via node itself instead, so
  // this is portable across the CI matrix's shells (sh vs. cmd.exe).
  const pngPath = join(fixtures, "logo.png");
  const script = `process.stdout.write(require("fs").readFileSync(${JSON.stringify(pngPath)}))`;
  const cmd = `${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)}`;
  const node: Descriptor = { tag: "file", props: { name: "out.png", cmd }, children: [] };
  const [resolved] = await resolve([node], { cwd: fixtures, allowExec: true });
  const content = (resolved.props as { __resolvedContent?: string | Buffer }).__resolvedContent;
  assert.ok(Buffer.isBuffer(content));
  const original = await readFile(pngPath);
  assert.ok((content as Buffer).equals(original));
});

test("imports a code src file's default export as inlined children", async () => {
  const node: Descriptor = { tag: "file", props: { name: "out.html", src: "partial.js" }, children: [] };
  const [resolved] = await resolve([node], { cwd: fixtures });
  assert.equal(resolved.children.length, 1);
  const child = resolved.children[0] as Descriptor;
  assert.equal(child.tag, "file");
  assert.deepEqual(child.children, ["partial content"]);
});

test("two separate <file src> occurrences of the same code partial get independent object graphs (SS5.4)", async () => {
  // Node's import() cache returns the exact same module object every time --
  // without cloning, both occurrences below would splice the identical
  // descriptor instance into two different places in the tree.
  const a: Descriptor = { tag: "file", props: { name: "a.html", src: "self-linking-partial.js" }, children: [] };
  const b: Descriptor = { tag: "file", props: { name: "b.html", src: "self-linking-partial.js" }, children: [] };
  const [resolvedA, resolvedB] = await resolve([a, b], { cwd: fixtures });
  const childA = resolvedA.children[0] as Descriptor;
  const childB = resolvedB.children[0] as Descriptor;
  assert.notEqual(childA, childB);

  const targetA = childA.children[0] as Descriptor;
  const targetB = childB.children[0] as Descriptor;
  assert.notEqual(targetA, targetB);
  assert.deepEqual(targetA.children, ["TARGET"]);
  assert.deepEqual(targetB.children, ["TARGET"]);

  // Each clone's internal linkTo() target must point at *that clone's own*
  // nested target -- not the other clone's, and not the original.
  const linkRefA = childA.children[2] as unknown as { target: Descriptor };
  const linkRefB = childB.children[2] as unknown as { target: Descriptor };
  assert.equal(linkRefA.target, targetA);
  assert.equal(linkRefB.target, targetB);
});

test("awaits an already-in-flight src promise directly as content", async () => {
  const node: Descriptor = {
    tag: "file",
    props: { name: "out.txt", src: Promise.resolve("async content") },
    children: [],
  };
  const [resolved] = await resolve([node], { cwd: fixtures });
  assert.equal((resolved.props as { __resolvedContent?: string }).__resolvedContent, "async content");
});

test("expands <dir from> into synthesized file children", async () => {
  const node: Descriptor = { tag: "dir", props: { name: "out", from: "*.txt" }, children: [] };
  const [resolved] = await resolve([node], { cwd: fixtures });
  assert.equal(resolved.children.length, 1);
  assert.equal((resolved.children[0] as Descriptor).props.name, "hello.txt");
});

test("<dir from> with a recursive glob preserves subdirectory structure instead of flattening to a basename", async () => {
  const node: Descriptor = { tag: "dir", props: { name: "out", from: "nested-assets/**/*" }, children: [] };
  const [resolved] = await resolve([node], { cwd: fixtures });
  const names = resolved.children.map((c) => (c as Descriptor).props.name).sort();
  assert.deepEqual(names, ["css/style.css", "en/index.html", "fr/index.html", "img/logo.png"]);
});

test("<dir from> preserving structure means same-basename files in different subdirectories no longer collide", async () => {
  const node: Descriptor = { tag: "dir", props: { name: "out", from: "nested-assets/{en,fr}/*.html" }, children: [] };
  const [resolved] = await resolve([node], { cwd: fixtures });
  const byName = new Map((resolved.children as Descriptor[]).map((c) => [c.props.name, c]));
  assert.equal(byName.size, 2);
  assert.ok(byName.has("en/index.html"));
  assert.ok(byName.has("fr/index.html"));
});

test(
  "<dir from> skips a symlink pointing at a directory instead of crashing with EISDIR, with a warning",
  async () => {
    // glob's `nodir: true` filters by each entry's own dirent type (an
    // lstat), not its followed real type -- a symlink whose *target* is a
    // directory survives that filter and comes back as a "file" match.
    // Reading it later used to throw a raw EISDIR instead of being skipped.
    const root = await mkdtemp(join(tmpdir(), "fileable-resolve-symlink-"));
    try {
      const src = join(root, "src");
      await mkdir(src, { recursive: true });
      await writeFile(join(src, "real.txt"), "real file\n");
      await symlink(".", join(src, "loop"));

      drainBuildContext();
      const node: Descriptor = { tag: "dir", props: { name: "out", from: "src/**/*" }, children: [] };
      const [resolved] = await resolve([node], { cwd: root });
      const names = (resolved.children as Descriptor[]).map((c) => c.props.name as string).sort();
      // How far glob descends into a matched symlinked directory before its
      // own `follow: false` stops it is platform/Node-version-dependent --
      // confirmed by CI itself: macOS/Linux return one level ("loop/real.txt"
      // alongside "real.txt"), Windows on Node 18 returns none at all (glob's
      // `nodir` filter excludes the "loop" match itself there). What must
      // hold everywhere is the actual guarantee this test exists for: the
      // real file is always found, and nothing from *inside* the symlinked
      // directory beyond one level (a true cycle) is ever read.
      assert.ok(names.includes("real.txt"));
      assert.ok(names.every((name) => !name.startsWith("loop/loop")));
      assert.ok(!names.includes("loop"));

      const { warnings } = drainBuildContext();
      // Only asserted when this platform's glob actually returned "loop" (or
      // deeper) as a candidate match in the first place -- see above.
      if (names.some((name) => name.startsWith("loop/")) || warnings.length > 0) {
        assert.ok(warnings.some((w) => w.includes("loop") && w.includes("symlink to a directory")));
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test("<dir from> preserves subdirectory structure (no basename collision) even when the pattern is absolute", async () => {
  // Resolving the pattern's own base against `baseDir` up front (rather than
  // string-prefix-matching an absolute base against a path-relative-to-
  // baseDir) is what makes this work -- the mismatched representations used
  // to silently fail the prefix check and collapse every match to a bare
  // basename, so two same-named files in different subdirs collided.
  const root = await mkdtemp(join(tmpdir(), "fileable-resolve-absolute-glob-"));
  try {
    const a = join(root, "src", "a");
    const b = join(root, "src", "b");
    await mkdir(a, { recursive: true });
    await mkdir(b, { recursive: true });
    await writeFile(join(a, "same.txt"), "A");
    await writeFile(join(b, "same.txt"), "B");

    const pattern = join(root, "src", "**", "*").split("\\").join("/");
    const node: Descriptor = { tag: "dir", props: { name: "out", from: pattern }, children: [] };
    const [resolved] = await resolve([node], { cwd: root });
    const byName = new Map((resolved.children as Descriptor[]).map((c) => [c.props.name, c]));
    assert.equal(byName.size, 2);
    assert.ok(byName.has("a/same.txt"));
    assert.ok(byName.has("b/same.txt"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("<dir from> matching a code file imports its default export, same as a direct src", async () => {
  const node: Descriptor = { tag: "dir", props: { name: "out", from: "partial.js" }, children: [] };
  const [resolved] = await resolve([node], { cwd: fixtures });
  assert.equal(resolved.children.length, 1);
  const synthesized = resolved.children[0] as Descriptor;
  assert.equal(synthesized.props.name, "partial.js");
  assert.equal(synthesized.children.length, 1);
  const imported = synthesized.children[0] as Descriptor;
  assert.deepEqual(imported.children, ["partial content"]);
});

test("src pointing at a URL fetches it", async () => {
  const { createServer } = await import("node:http");
  const server = createServer((_req, res) => {
    res.end("remote content");
  });
  await new Promise<void>((resolvePromise) => server.listen(0, resolvePromise));
  const port = (server.address() as { port: number }).port;
  try {
    const node: Descriptor = {
      tag: "file",
      props: { name: "out.txt", src: `http://127.0.0.1:${port}/hello.txt` },
      children: [],
    };
    const [resolved] = await resolve([node], { cwd: fixtures });
    assert.equal((resolved.props as { __resolvedContent?: string }).__resolvedContent, "remote content");
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
});

test("src pointing at a URL that 404s throws a FileableError", async () => {
  const { createServer } = await import("node:http");
  const server = createServer((_req, res) => {
    res.statusCode = 404;
    res.end("not found");
  });
  await new Promise<void>((resolvePromise) => server.listen(0, resolvePromise));
  const port = (server.address() as { port: number }).port;
  try {
    const node: Descriptor = {
      tag: "file",
      props: { name: "out.txt", src: `http://127.0.0.1:${port}/missing.txt` },
      children: [],
    };
    await assert.rejects(() => resolve([node], { cwd: fixtures }), FileableError);
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
});

test("cmd throws without allowExec", async () => {
  const node: Descriptor = { tag: "file", props: { name: "out.txt", cmd: "echo hi" }, children: [] };
  await assert.rejects(() => resolve([node], { cwd: fixtures }), FileableError);
});

test("cmd runs and captures stdout when allowExec is true", async () => {
  const node: Descriptor = { tag: "file", props: { name: "out.txt", cmd: "echo hi" }, children: [] };
  const [resolved] = await resolve([node], { cwd: fixtures, allowExec: true });
  assert.equal((resolved.props as { __resolvedContent?: string }).__resolvedContent?.trim(), "hi");
});

test("cmd that exits non-zero rejects with a FileableError", async () => {
  const node: Descriptor = { tag: "file", props: { name: "out.txt", cmd: "exit 1" }, children: [] };
  await assert.rejects(() => resolve([node], { cwd: fixtures, allowExec: true }), FileableError);
});

test("src pointing at a nonexistent plain file rejects with a FileableError", async () => {
  const node: Descriptor = { tag: "file", props: { name: "out.txt", src: "does-not-exist.txt" }, children: [] };
  await assert.rejects(() => resolve([node], { cwd: fixtures }), FileableError);
});

test("src pointing at a nonexistent code module rejects with a FileableError explaining pre-compilation", async () => {
  const node: Descriptor = { tag: "file", props: { name: "out.html", src: "does-not-exist.js" }, children: [] };
  await assert.rejects(() => resolve([node], { cwd: fixtures }), (error: unknown) => {
    assert.ok(error instanceof FileableError);
    assert.match(error.message, /must already be compiled/);
    return true;
  });
});

test("<dir from> accepts an already-resolved array of paths directly", async () => {
  const node: Descriptor = { tag: "dir", props: { name: "out", from: [join(fixtures, "hello.txt")] }, children: [] };
  const [resolved] = await resolve([node], { cwd: fixtures });
  assert.equal(resolved.children.length, 1);
  assert.equal((resolved.children[0] as Descriptor).props.name, "hello.txt");
});

test("<dir from> as a rejected promise rejects with a FileableError", async () => {
  const node: Descriptor = { tag: "dir", props: { name: "out", from: Promise.reject(new Error("boom")) }, children: [] };
  await assert.rejects(() => resolve([node], { cwd: fixtures }), FileableError);
});

test("any other promise-valued prop (future-proofing) is generically awaited and replaced", async () => {
  const node: Descriptor = { tag: "file", props: { name: "out.txt", custom: Promise.resolve("resolved-value") }, children: [] };
  const [resolved] = await resolve([node], { cwd: fixtures });
  assert.equal(resolved.props.custom, "resolved-value");
});

test("a rejected non-src/cmd promise-valued prop is wrapped with the prop name", async () => {
  const node: Descriptor = { tag: "file", props: { name: "out.txt", custom: Promise.reject(new Error("boom")) }, children: [] };
  await assert.rejects(() => resolve([node], { cwd: fixtures }), (error: unknown) => {
    assert.ok(error instanceof FileableError);
    assert.match(error.message, /prop "custom"/);
    return true;
  });
});

test("wraps a rejected promise prop with the node's tree path", async () => {
  const node: Descriptor = {
    tag: "file",
    props: { name: "out.txt", src: Promise.reject(new Error("boom")) },
    children: [],
  };
  await assert.rejects(() => resolve([node], { cwd: fixtures }), (error: unknown) => {
    assert.ok(error instanceof FileableError);
    assert.match(error.path, /file/);
    return true;
  });
});
