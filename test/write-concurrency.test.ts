// Issue #22: the loose writer and the warm-cache existence checks run with
// bounded concurrency. These pin the edge cases that introduces: output and
// result order must be exactly what the old one-at-a-time loop produced.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { render } from "../src/render.js";
import { IO_CONCURRENCY, mapLimit } from "../src/concurrency.js";
import { FileableError } from "../src/types.js";
import type { Descriptor } from "../src/types.js";

const file = (name: string, content: string, props: Record<string, unknown> = {}): Descriptor => ({
  tag: "file",
  props: { name, ...props },
  children: [content],
});
const dir = (name: string, children: Descriptor[], props: Record<string, unknown> = {}): Descriptor => ({
  tag: "dir",
  props: { name, ...props },
  children,
});

async function withOutDir(fn: (outDir: string) => Promise<void>): Promise<void> {
  const outDir = await mkdtemp(join(tmpdir(), "fileable-concurrency-"));
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  try {
    await fn(outDir);
    // Let any stray rejection surface before checking.
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(unhandled, [], "no unhandled rejections");
  } finally {
    process.off("unhandledRejection", onUnhandled);
    await rm(outDir, { recursive: true, force: true });
  }
}

/** 12 dirs x 3 levels deep, `perDir` files each; mode on every 7th file. */
function wideTree(perDir: number, fileProps: (i: number) => Record<string, unknown> = () => ({})): Descriptor {
  let i = 0;
  const leaf = (name: string) =>
    dir(
      name,
      Array.from({ length: perDir }, () => {
        const n = i++;
        return file(`f${n}.txt`, `content ${n}\n`, { ...(n % 7 === 0 ? { mode: "755" } : {}), ...fileProps(n) });
      }),
    );
  return dir("site", [
    file("index.html", "<h1>index</h1>"),
    ...["a", "b", "c", "d"].map((top) => dir(top, [leaf("x"), dir("y", [leaf("z")]), leaf("w")])),
  ]);
}

/** Every output path in tree pre-order (artifact order). */
function preorder(tree: Descriptor): string[] {
  const out: string[] = [];
  const walk = (node: Descriptor, prefix: string) => {
    const path = prefix ? `${prefix}/${node.props.name}` : String(node.props.name);
    out.push(path);
    if (node.tag === "dir") for (const child of node.children as Descriptor[]) walk(child, path);
  };
  walk(tree, "");
  return out;
}

/** The order the sequential writer reported: every loose dir (tree pre-order), then every file (tree pre-order). */
function expectedWritten(tree: Descriptor): string[] {
  const dirs: string[] = [];
  const files: string[] = [];
  const walk = (node: Descriptor, prefix: string) => {
    const path = prefix ? `${prefix}/${node.props.name}` : String(node.props.name);
    if (node.tag === "dir") {
      dirs.push(path);
      for (const child of node.children as Descriptor[]) walk(child, path);
    } else files.push(path);
  };
  walk(tree, "");
  return [...dirs, ...files];
}

test("many files across shared directories: every byte and mode, written[] in artifact order", async () => {
  await withOutDir(async (outDir) => {
    const tree = wideTree(25); // 300 files + index, well above IO_CONCURRENCY
    const result = await render(tree, { outDir });
    assert.deepEqual(result.written, expectedWritten(tree));
    assert.deepEqual(result.skipped, []);
    for (let n = 0; n < 300; n++) {
      const rel = result.written.find((p) => p.endsWith(`/f${n}.txt`))!;
      assert.equal(await readFile(join(outDir, rel), "utf8"), `content ${n}\n`);
      if (process.platform !== "win32" && n % 7 === 0) {
        assert.equal((await stat(join(outDir, rel))).mode & 0o777, 0o755);
      }
    }
    assert.deepEqual((await readdir(join(outDir, "site/a/y"))).sort(), ["z"]);
  });
});

test("warm run: deleted outputs are rewritten, the rest skipped, both lists in artifact order", async () => {
  await withOutDir(async (outDir) => {
    const tree = wideTree(25);
    const first = await render(tree, { outDir });
    const files = first.written.filter((p) => p.endsWith(".txt"));
    const deleted = [files[3], files[150], files[299]];
    for (const rel of deleted) await rm(join(outDir, rel));
    const second = await render(tree, { outDir });
    assert.deepEqual(second.written, deleted);
    // Unchanged-and-present artifacts are reported in artifact order.
    assert.deepEqual(
      second.skipped,
      preorder(tree).filter((p) => !deleted.includes(p)),
    );
    for (const rel of deleted) assert.match(await readFile(join(outDir, rel), "utf8"), /^content \d+\n$/);
  });
});

test("a failing write among many: rejects with the first failure in artifact order, nothing left running", async () => {
  await withOutDir(async (outDir) => {
    // onConflict="error" on every file; pre-existing files make #40 and #200 fail.
    const tree = wideTree(25, () => ({ onConflict: "error" }));
    const paths = expectedWritten(tree).filter((p) => p.endsWith(".txt"));
    const early = paths.find((p) => p.endsWith("/f40.txt"))!;
    const late = paths.find((p) => p.endsWith("/f200.txt"))!;
    for (const rel of [early, late]) {
      await mkdir(join(outDir, rel, ".."), { recursive: true });
      await writeFile(join(outDir, rel), "pre-existing");
    }
    await assert.rejects(render(tree, { outDir }), (error: unknown) => {
      assert.ok(error instanceof FileableError);
      assert.equal(error.path, early);
      return true;
    });
    // Everything before the failing artifact was written, as before.
    for (const rel of paths.slice(0, paths.indexOf(early))) {
      assert.match(await readFile(join(outDir, rel), "utf8"), /^content \d+\n$/);
    }
    assert.equal(await readFile(join(outDir, early), "utf8"), "pre-existing");
    assert.equal(await readFile(join(outDir, late), "utf8"), "pre-existing");
    // Writes after the failure point stopped within one concurrency window.
    const writtenAfter = [];
    for (const rel of paths.slice(paths.indexOf(early) + 1)) {
      try {
        if ((await readFile(join(outDir, rel), "utf8")).startsWith("content")) writtenAfter.push(rel);
      } catch {
        // not written
      }
    }
    assert.ok(writtenAfter.length < IO_CONCURRENCY, `${writtenAfter.length} files written after the failure`);
  });
});

test("an OS-level write error among many (a directory in a file's place) rejects cleanly", async () => {
  await withOutDir(async (outDir) => {
    const tree = wideTree(25);
    const paths = expectedWritten(tree).filter((p) => p.endsWith(".txt"));
    const blocked = paths[120];
    await mkdir(join(outDir, blocked), { recursive: true });
    await assert.rejects(render(tree, { outDir }), (error: NodeJS.ErrnoException) => {
      assert.ok(["EISDIR", "EPERM", "EACCES"].includes(String(error.code)), String(error.code));
      return true;
    });
  });
});

test("append/prepend across many files keep every existing byte, in the right order", async () => {
  await withOutDir(async (outDir) => {
    const tree = wideTree(25, (n) => ({ onConflict: n % 2 === 0 ? "append" : "prepend" }));
    const paths = expectedWritten(tree).filter((p) => p.endsWith(".txt"));
    for (const rel of paths) {
      await mkdir(join(outDir, rel, ".."), { recursive: true });
      await writeFile(join(outDir, rel), "OLD\n");
    }
    await render(tree, { outDir, cache: false });
    for (const rel of paths) {
      const n = Number(/f(\d+)\.txt$/.exec(rel)![1]);
      const expected = n % 2 === 0 ? `OLD\ncontent ${n}\n` : `content ${n}\nOLD\n`;
      assert.equal(await readFile(join(outDir, rel), "utf8"), expected, rel);
    }
  });
});

test("paths that are one file on a case-insensitive filesystem are refused on every filesystem (#31)", async () => {
  await withOutDir(async (outDir) => {
    await mkdir(join(outDir, "site"));
    await writeFile(join(outDir, "site/notes.txt"), "0");
    const filler = Array.from({ length: 100 }, (_, i) => file(`fill${i}.txt`, "x"));
    const tree = dir("site", [
      ...filler.slice(0, 10),
      file("notes.txt", "1", { onConflict: "append" }),
      file("NOTES.txt", "2", { onConflict: "prepend" }),
      ...filler.slice(10),
    ]);
    await assert.rejects(
      () => render(tree, { outDir, cache: false }),
      (e: unknown) => e instanceof FileableError && e.code === "E_PATH_CONFLICT",
    );
    // Refused in layout, before anything is written.
    assert.deepEqual(await readdir(join(outDir, "site")), ["notes.txt"]);
    assert.equal(await readFile(join(outDir, "site/notes.txt"), "utf8"), "0");
  });
});

test("dry-run with many files touches nothing and reports the same lists", async () => {
  await withOutDir(async (outDir) => {
    const tree = wideTree(25);
    const result = await render(tree, { outDir, dryRun: true });
    assert.deepEqual(result.written, expectedWritten(tree));
    assert.deepEqual(await readdir(outDir), []);
  });
});

test("<Dir mode> is applied, and directories still get created under it", async () => {
  await withOutDir(async (outDir) => {
    const tree = dir("site", [dir("bin", [dir("sub", [file("run.sh", "#!/bin/sh")])], { mode: "700" })]);
    await render(tree, { outDir });
    assert.equal(await readFile(join(outDir, "site/bin/sub/run.sh"), "utf8"), "#!/bin/sh");
    if (process.platform !== "win32") assert.equal((await stat(join(outDir, "site/bin"))).mode & 0o777, 0o700);
  });
});

test("mapLimit: input-order results, never more than `limit` in flight", async () => {
  let inFlight = 0;
  let peak = 0;
  const out = await mapLimit(
    Array.from({ length: 50 }, (_, i) => i),
    4,
    async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, (n * 7) % 5));
      inFlight--;
      return n * 2;
    },
  );
  assert.deepEqual(out, Array.from({ length: 50 }, (_, i) => i * 2));
  assert.equal(peak, 4);
  assert.deepEqual(await mapLimit([], 4, async () => 1), []);
});

test("mapLimit: rejects with the lowest-index error only after in-flight calls settle, starts nothing after", async () => {
  const started: number[] = [];
  const settled: number[] = [];
  await assert.rejects(
    mapLimit(
      Array.from({ length: 20 }, (_, i) => i),
      4,
      async (n) => {
        started.push(n);
        // #5 fails late, #6 fails early: #5's error must win.
        await new Promise((r) => setTimeout(r, n === 5 ? 30 : n === 6 ? 1 : 10));
        settled.push(n);
        if (n === 5 || n === 6) throw new Error(`fail ${n}`);
        return n;
      },
    ),
    /fail 5/,
  );
  assert.deepEqual([...settled].sort((a, b) => a - b), [...started].sort((a, b) => a - b));
  assert.ok(Math.max(...started) < 6 + 4, `started up to #${Math.max(...started)}`);
});
