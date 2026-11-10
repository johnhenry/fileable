/**
 * #31: the loose writer (and the archive encoders) never write outside
 * outDir. Each test renders into `<root>/out` next to `<root>/outside`,
 * which holds a sentinel file, and checks `<root>/outside` is untouched.
 * Directory links are made as junctions on Windows (no privilege needed);
 * file links fall back to a hard link where Windows refuses a symlink.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { link, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, unzipSync, zipSync } from "fflate";
import { render } from "../src/render.js";
import { writeZips } from "../src/write/zip.js";
import { writeWbn } from "../src/write/wbn.js";
import { FileableError } from "../src/types.js";
import type { Descriptor, HashedArtifact } from "../src/types.js";

const isWindows = process.platform === "win32";
const file = (name: string, content = "x", props: Record<string, unknown> = {}): Descriptor => ({ tag: "file", props: { name, ...props }, children: [content] });
const dir = (name: string, children: Descriptor[], props: Record<string, unknown> = {}): Descriptor => ({ tag: "dir", props: { name, ...props }, children });

interface Fixture {
  root: string;
  out: string;
  outside: string;
}

async function withFixture(fn: (f: Fixture) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "fileable-contain-"));
  const out = join(root, "out");
  const outside = join(root, "outside");
  await mkdir(out);
  await mkdir(outside);
  await writeFile(join(outside, "sentinel.txt"), "original");
  try {
    await fn({ root, out, outside });
    assert.deepEqual(await listOutside(outside), ["sentinel.txt"], "nothing may be written outside outDir");
    assert.equal(await readFile(join(outside, "sentinel.txt"), "utf8"), "original");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function listOutside(outside: string): Promise<string[]> {
  return (await readdir(outside, { recursive: true })).map((p) => p.replaceAll("\\", "/")).sort();
}

/** A directory link: a junction on Windows (works without Developer Mode), a symlink elsewhere. */
async function dirLink(target: string, path: string): Promise<void> {
  await symlink(target, path, isWindows ? "junction" : "dir");
}

/** A file symlink, or `false` where the OS refuses one (Windows without the privilege). */
async function fileSymlink(target: string, path: string): Promise<boolean> {
  try {
    await symlink(target, path, "file");
    return true;
  } catch (error) {
    if (isWindows && (error as NodeJS.ErrnoException).code === "EPERM") return false;
    throw error;
  }
}

async function rejectsWith(code: string, run: () => Promise<unknown>): Promise<FileableError> {
  let caught: unknown;
  try {
    await run();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof FileableError, `expected a FileableError(${code}), got ${String(caught)}`);
  assert.equal(caught.code, code, caught.message);
  return caught;
}

// --- Template names ---------------------------------------------------------

const UNSAFE_TEMPLATE_NAMES: Array<[string, string]> = [
  ["../escaped.txt", "traversal"],
  ["../../escaped.txt", "traversal"],
  ["a/../../escaped.txt", "traversal"],
  ["/abs/escaped.txt", "absolute"],
  ["C:/escaped.txt", "absolute"],
  ["C:escaped.txt", "absolute"],
  ["..\\escaped.txt", "backslash"],
  ["a\\..\\..\\escaped.txt", "backslash"],
  ["nul\0.txt", "control-character"],
  ["new\nline.txt", "control-character"],
  [".../escaped.txt", "dot-segment"],
  [".. /escaped.txt", "traversal"],
  [".", "dot-segment"],
];

for (const [name, reason] of UNSAFE_TEMPLATE_NAMES) {
  test(`a template <File name=${JSON.stringify(name)}> is refused with E_UNSAFE_PATH (${reason})`, async () => {
    await withFixture(async ({ out }) => {
      const error = await rejectsWith("E_UNSAFE_PATH", () => render(file(name), { outDir: out, cache: false }));
      assert.match(error.message, new RegExp(`\\(${reason}\\)`));
      assert.deepEqual(await readdir(out), [], "refused before anything is written");
    });
  });
}

test("a template <Dir name=\"..\">, and a nested name that climbs out of outDir, are refused", async () => {
  await withFixture(async ({ out }) => {
    await rejectsWith("E_UNSAFE_PATH", () => render(dir("site", [file("../../escaped.txt")]), { outDir: out, cache: false }));
    await rejectsWith("E_UNSAFE_PATH", () => render(dir("site", [file("a\\..\\..\\escaped.txt")]), { outDir: out, cache: false }));
    await rejectsWith("E_UNSAFE_PATH", () => render(dir("site", [file("nul\0.txt")]), { outDir: out, cache: false }));
    await rejectsWith("E_UNSAFE_PATH", () => render(dir("..", [file("escaped.txt")]), { outDir: out, cache: false }));
    await rejectsWith("E_UNSAFE_PATH", () => render(dir("a", [dir("../..", [file("escaped.txt")])]), { outDir: out, cache: false }));
    await rejectsWith("E_UNSAFE_PATH", () => render(file("../outside/sentinel.txt", "pwned"), { outDir: out, cache: false }));
    await rejectsWith("E_UNSAFE_PATH", () => render(file("../outside/sentinel.txt", "pwned"), { outDir: out, cache: false, dryRun: true }));
  });
});

test("names that normalize to a path inside outDir still work, and <Dir name=\".\"> is outDir itself", async () => {
  await withFixture(async ({ out }) => {
    await render(dir(".", [file("a/../b.txt", "b"), dir("sub/./deeper", [file("c.txt", "c")]), file("..foo", "dots")]), { outDir: out, cache: false });
    assert.equal(await readFile(join(out, "b.txt"), "utf8"), "b");
    assert.equal(await readFile(join(out, "sub/deeper/c.txt"), "utf8"), "c");
    assert.equal(await readFile(join(out, "..foo"), "utf8"), "dots");
  });
});

test("an <Rm target> that leaves outDir is refused and deletes nothing", async () => {
  await withFixture(async ({ out }) => {
    for (const target of ["../outside/sentinel.txt", "../outside/*", "!../outside/*", "a/../../outside/*"]) {
      await rejectsWith("E_UNSAFE_PATH", () => render({ tag: "rm", props: { target }, children: [] }, { outDir: out, cache: false }));
    }
  });
});

// --- Symlinks already inside outDir ----------------------------------------

test("a write through an existing directory link that leads outside outDir is refused", async () => {
  await withFixture(async ({ out, outside }) => {
    await dirLink(outside, join(out, "link"));
    await rejectsWith("E_UNSAFE_PATH", () => render(file("link/escaped.txt", "pwned"), { outDir: out, cache: false }));
    await rejectsWith("E_UNSAFE_PATH", () => render(file("link/sentinel.txt", "pwned"), { outDir: out, cache: false }));
    await rejectsWith("E_UNSAFE_PATH", () => render(dir("link", [file("deeper/escaped.txt")]), { outDir: out, cache: false }));
    // A <Dir mode> on the link would chmod the directory it points at.
    await rejectsWith("E_UNSAFE_PATH", () => render(dir("link", [], { mode: "700" }), { outDir: out, cache: false }));
    // A dry run reports the same refusal.
    await rejectsWith("E_UNSAFE_PATH", () => render(file("link/escaped.txt"), { outDir: out, cache: false, dryRun: true }));
  });
});

test("a link deeper in the tree, and a dangling link, are refused too", async () => {
  await withFixture(async ({ out, outside }) => {
    await mkdir(join(out, "a/b"), { recursive: true });
    await dirLink(outside, join(out, "a/b/link"));
    await rejectsWith("E_UNSAFE_PATH", () => render(dir("a", [dir("b", [dir("link", [dir("c", [file("x.txt")])])])]), { outDir: out, cache: false }));
    await dirLink(join(outside, "missing"), join(out, "dangling"));
    await rejectsWith("E_UNSAFE_PATH", () => render(file("dangling/x.txt"), { outDir: out, cache: false }));
  });
});

test("a link to a directory inside outDir may be written through", async () => {
  await withFixture(async ({ out }) => {
    await mkdir(join(out, "real"));
    await dirLink(join(out, "real"), join(out, "alias"));
    await render(file("alias/x.txt", "through"), { outDir: out, cache: false });
    assert.equal(await readFile(join(out, "real/x.txt"), "utf8"), "through");
  });
});

test("a decoded archive entry can't write through a link made by an earlier build's <File symlink>", async () => {
  await withFixture(async ({ out }) => {
    const first = dir("site", [file("link", "", { symlink: "../../outside" })]);
    await render(first, { outDir: out, cache: false });
    const madeLink = (await lstat(join(out, "site/link"))).isSymbolicLink();

    await writeFile(join(out, "evil.zip"), zipSync({ "link/escaped.txt": strToU8("pwned"), "link/sentinel.txt": strToU8("pwned") }));
    const second: Descriptor = { tag: "dir", props: { name: "site", src: "../evil.zip", decode: "zip" }, children: [] };
    if (madeLink) {
      await rejectsWith("E_UNSAFE_PATH", () => render(second, { outDir: out, cwd: join(out, "site"), cache: false }));
    } else {
      // Windows without the symlink privilege: the link was materialized as
      // a copy, so `link` is a plain file and the write fails on that.
      await assert.rejects(() => render(second, { outDir: out, cwd: join(out, "site"), cache: false }));
    }
  });
});

test("a decoded entry under a template <File symlink> in the same build is E_PATH_CONFLICT", async () => {
  await withFixture(async ({ out }) => {
    await writeFile(join(out, "evil.zip"), zipSync({ "link/escaped.txt": strToU8("pwned") }));
    const tree: Descriptor = {
      tag: "dir",
      props: { name: "site", src: "evil.zip", decode: "zip" },
      children: [file("link", "", { symlink: "../../outside" })],
    };
    const error = await rejectsWith("E_PATH_CONFLICT", () => render(tree, { outDir: out, cwd: out, cache: false }));
    assert.match(error.message, /a symlink/);
    assert.deepEqual(await readdir(out), ["evil.zip"]);
  });
});

test("replacing a file that is a symlink to outside replaces the link, never the target", async () => {
  await withFixture(async ({ out, outside }) => {
    const target = join(outside, "sentinel.txt");
    if (!(await fileSymlink(target, join(out, "f.txt")))) await link(target, join(out, "f.txt"));
    await render(file("f.txt", "new"), { outDir: out, cache: false });
    assert.equal(await readFile(join(out, "f.txt"), "utf8"), "new");
    const info = await lstat(join(out, "f.txt"));
    assert.ok(info.isFile() && !info.isSymbolicLink() && info.nlink === 1);
  });
});

test("append/prepend refuse a symlink that leads outside outDir", async () => {
  await withFixture(async ({ out, outside }) => {
    if (!(await fileSymlink(join(outside, "sentinel.txt"), join(out, "f.txt")))) return assertHardLinkRefused(out, outside);
    for (const onConflict of ["append", "prepend"]) {
      await rejectsWith("E_UNSAFE_PATH", () => render(file("f.txt", "pwned", { onConflict }), { outDir: out, cache: false }));
    }
    // "skip" and "error" see the link as an existing file and leave it alone.
    await render(file("f.txt", "pwned", { onConflict: "skip" }), { outDir: out, cache: false });
    await rejectsWith("E_CONFLICT", () => render(file("f.txt", "pwned", { onConflict: "error" }), { outDir: out, cache: false }));
  });
});

async function assertHardLinkRefused(out: string, outside: string): Promise<void> {
  await rm(join(out, "f.txt"), { force: true });
  await link(join(outside, "sentinel.txt"), join(out, "f.txt"));
  for (const onConflict of ["append", "prepend"]) {
    const error = await rejectsWith("E_UNSAFE_PATH", () => render(file("f.txt", "pwned", { onConflict }), { outDir: out, cache: false }));
    assert.match(error.message, /hard link/);
  }
}

test("a hard link to a file outside outDir: replace breaks the link, append/prepend refuse", async () => {
  await withFixture(async ({ out, outside }) => {
    await assertHardLinkRefused(out, outside);
    await render(file("f.txt", "new"), { outDir: out, cache: false });
    assert.equal(await readFile(join(out, "f.txt"), "utf8"), "new");
  });
});

test("an <Rm> whose glob walks through a link to outside is refused", async () => {
  await withFixture(async ({ out, outside }) => {
    await dirLink(outside, join(out, "link"));
    await rejectsWith("E_UNSAFE_PATH", () => render({ tag: "rm", props: { target: "link/*" }, children: [] }, { outDir: out, cache: false }));
    await rejectsWith("E_UNSAFE_PATH", () => render({ tag: "rm", props: { target: "link/sentinel.txt" }, children: [] }, { outDir: out, cache: false, dryRun: true }));
    // Removing the link itself is fine: rm doesn't follow it.
    await render({ tag: "rm", props: { target: "link", kind: "any" }, children: [] }, { outDir: out, cache: false });
    assert.deepEqual(await readdir(out), [".fileable-lock.json"]);
  });
});

test("an archive file and the lock file are never written through a link", async () => {
  await withFixture(async ({ out, outside }) => {
    const target = join(outside, "sentinel.txt");
    const zipLinked = await fileSymlink(target, join(out, "site.zip"));
    if (!zipLinked) await link(target, join(out, "site.zip"));
    if (!(await fileSymlink(target, join(out, ".fileable-lock.json")))) await link(target, join(out, ".fileable-lock.json"));
    await render(dir("site", [file("a.txt", "a")], { encode: "zip" }), { outDir: out });
    assert.deepEqual(Object.keys(unzipSync(await readFile(join(out, "site.zip")))), ["a.txt"]);
    assert.ok(!(await lstat(join(out, ".fileable-lock.json"))).isSymbolicLink());
  });
});

test("an archive file under a directory link to outside is refused", async () => {
  await withFixture(async ({ out, outside }) => {
    await dirLink(outside, join(out, "link"));
    await rejectsWith("E_UNSAFE_PATH", () => render(dir("link", [dir("site", [file("a.txt")], { encode: "zip" })]), { outDir: out, cache: false }));
    await rejectsWith("E_UNSAFE_PATH", () => render(dir("link", [dir("site", [file("a.txt")], { encode: "wbn" })]), { outDir: out, cache: false }));
  });
});

// --- Encoders ---------------------------------------------------------------

for (const encode of ["zip", "wbn"] as const) {
  test(`encode="${encode}" refuses an entry name that would escape the archive`, async () => {
    await withFixture(async ({ out }) => {
      for (const name of ["../x.txt", "a/../../x.txt", "/x.txt", "C:x.txt", "a\\..\\x.txt", "nul\0.txt"]) {
        await rejectsWith("E_UNSAFE_PATH", () => render(dir("site", [file(name)], { encode }), { outDir: out, cache: false }));
      }
      await rejectsWith("E_UNSAFE_PATH", () => render(dir("site", [dir("..", [file("x.txt")])], { encode }), { outDir: out, cache: false }));
      assert.deepEqual(await readdir(out), []);
    });
  });

  test(`encode="${encode}" writer refuses an unsafe entry name even without layout's check`, async () => {
    await withFixture(async ({ out }) => {
      const container = `site.${encode}`;
      const artifact = (outputPath: string, kind: "file" | "dir", isRoot = false): HashedArtifact => ({
        id: isRoot ? container : `${container}::${outputPath}`,
        kind,
        descriptor: { tag: kind, props: {}, children: [] },
        outputPath,
        target: encode,
        containerPath: container,
        children: [],
        content: "x",
        hash: "h",
        dependsOn: [],
      } as unknown as HashedArtifact);
      const artifacts = [artifact(container, "dir", true), artifact("../escaped.txt", "file")];
      const write = encode === "zip" ? writeZips : writeWbn;
      const error = await rejectsWith("E_UNSAFE_PATH", () => write(artifacts, out, new Set([container])));
      assert.match(error.message, /\(traversal\)/);
      await rejectsWith("E_UNSAFE_PATH", () => write(artifacts, out, new Set([container]), true));
      assert.deepEqual(await readdir(out), []);
    });
  });
}

// --- Case and Unicode-normalization collisions ------------------------------

const NFC = "caf\u00e9.txt";
const NFD = "cafe\u0301.txt";

const COLLISIONS: Array<[string, Descriptor]> = [
  ["two files differing in case", dir("site", [file("A.txt"), file("a.txt")])],
  ["two files differing in normalization (NFC/NFD)", dir("site", [file(NFC), file(NFD)])],
  ["case and normalization together", dir("site", [file("CAF\u00c9.txt"), file(NFD)])],
  ["two directories differing in case", dir("site", [dir("Docs", [file("a.txt")]), dir("docs", [file("b.txt")])])],
  ["a file and a path under a case variant of it", dir("site", [file("readme"), file("README/x.txt")])],
  ["a file under a regular file of the same name", dir("site", [file("data"), file("data/x.txt")])],
  ["two archives differing in case", dir("site", [dir("bundle", [file("a.txt")], { encode: "zip" }), file("BUNDLE.zip")])],
  ["two entries differing in case inside a zip", dir("site", [file("A.txt"), file("a.txt")], { encode: "zip" })],
  ["two entries differing in case inside a wbn", dir("site", [file("A.txt"), file("a.txt")], { encode: "wbn" })],
];

for (const [label, tree] of COLLISIONS) {
  test(`E_PATH_CONFLICT on every filesystem: ${label}`, async () => {
    await withFixture(async ({ out }) => {
      await rejectsWith("E_PATH_CONFLICT", () => render(tree, { outDir: out, cache: false }));
      assert.deepEqual(await readdir(out), [], "refused before anything is written");
    });
  });
}

test("decoded zip entries differing only in case or normalization are E_PATH_CONFLICT", async () => {
  await withFixture(async ({ out }) => {
    for (const [a, b] of [["A.txt", "a.txt"], [NFC, NFD], ["Dir/x.txt", "dir/x.txt"]]) {
      await writeFile(join(out, "in.zip"), zipSync({ [a]: strToU8("1"), [b]: strToU8("2") }));
      const tree: Descriptor = { tag: "dir", props: { name: "site", src: "in.zip", decode: "zip" }, children: [] };
      await rejectsWith("E_PATH_CONFLICT", () => render(tree, { outDir: out, cwd: out, cache: false }));
      assert.deepEqual(await readdir(out), ["in.zip"]);
    }
  });
});

test("a decoded entry colliding by case with a template file is E_PATH_CONFLICT", async () => {
  await withFixture(async ({ out }) => {
    await writeFile(join(out, "in.zip"), zipSync({ "INDEX.html": strToU8("from archive") }));
    const tree: Descriptor = { tag: "dir", props: { name: "site", src: "in.zip", decode: "zip" }, children: [file("index.html", "template")] };
    await rejectsWith("E_PATH_CONFLICT", () => render(tree, { outDir: out, cwd: out, cache: false }));
  });
});

test("the same name in different directories or different archives is not a collision", async () => {
  await withFixture(async ({ out }) => {
    const tree = [
      dir("one", [file("a.txt"), dir("A", [file("a.txt")])]),
      dir("two", [file("A.txt")], { encode: "zip" }),
      dir("three", [file("A.txt")], { encode: "zip" }),
    ];
    await render(tree, { outDir: out, cache: false });
    assert.deepEqual((await readdir(out)).sort(), [".fileable-lock.json", "one", "three.zip", "two.zip"]);
  });
});
