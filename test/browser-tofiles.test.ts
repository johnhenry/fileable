/**
 * `toFiles()` and the JSX-free builders from `@johnhenry/fileable/browser`:
 * run the browser-safe stages and return `{ relativePosixPath: string | Uint8Array }`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { linkTo, toFiles, h, dir, file, rm, Dir, File, Rm, Fragment } from "../src/browser/index.js";
import * as main from "../src/index.js";
import { FileableError } from "../src/types.js";

test("toFiles() returns path -> string for text and Uint8Array for binary (base64)", async () => {
  const bytes = new Uint8Array([0, 255, 128, 1]);
  const files = await toFiles(
    Dir({
      name: "site",
      children: [
        File({ name: "index.html", children: "<h1>hi</h1>" }),
        File({ name: "bin.dat", base64: Buffer.from(bytes).toString("base64") }),
        Dir({ name: "sub", children: File({ name: "a.txt", children: "a" }) }),
      ],
    }),
  );
  assert.deepEqual(Object.keys(files).sort(), ["site/bin.dat", "site/index.html", "site/sub/a.txt"]);
  assert.equal(files["site/index.html"], "<h1>hi</h1>");
  assert.ok(files["site/bin.dat"] instanceof Uint8Array);
  assert.deepEqual([...(files["site/bin.dat"] as Uint8Array)], [...bytes]);
});

test("toFiles() accepts an array of roots and no directory entries appear", async () => {
  const files = await toFiles([File({ name: "a.txt", children: "A" }), File({ name: "b.txt", children: "B" })]);
  assert.deepEqual(files, { "a.txt": "A", "b.txt": "B" });
});

test("toFiles() honors doctype and join", async () => {
  // doctype picks the linkTo() format: "markdown" -> [text](href), otherwise a bare href.
  const a = File({ name: "a.md", children: "A" });
  const md = await toFiles([a, File({ name: "b.md", doctype: "markdown", children: [linkTo(a, { text: "go" })] })]);
  assert.equal(md["b.md"], "[go](a.md)");
  const html = await toFiles([a, File({ name: "b.html", doctype: "html", children: [h("a", { href: linkTo(a) }, "go")] })]);
  assert.match(html["b.html"] as string, /<a href="a\.md">go<\/a>/);
  const merged = await toFiles(
    File({
      name: "m.html",
      join: "dom-merge",
      children: ["<html><head><title>T</title></head><body>H</body></html>", "<main>M</main>"],
    }),
  );
  assert.equal((merged["m.html"] as string).match(/<html>/g)?.length, 1);
  assert.match(merged["m.html"] as string, /<title>T<\/title>/);
  assert.match(merged["m.html"] as string, /<main>M<\/main>/);
  const concat = await toFiles(File({ name: "j.txt", join: "concat", children: ["a", "b"] }));
  assert.equal(concat["j.txt"], "ab");
  await assert.rejects(toFiles(File({ name: "j.txt", join: "newline" as never, children: ["a"] })), FileableError);
});

test("toFiles() fetches https:// and ipfs:// sources", async () => {
  const server: Server = createServer((req, res) => {
    res.writeHead(200);
    res.end(`body of ${req.url}`);
  });
  await new Promise<void>((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const files = await toFiles(
      Dir({
        name: "d",
        children: [File({ name: "h.txt", src: `${base}/x` }), File({ name: "i.txt", src: "ipfs://cid/p" })],
      }),
      { ipfsGateway: `${base}/ipfs/` },
    );
    assert.equal(files["d/h.txt"], "body of /x");
    assert.equal(files["d/i.txt"], "body of /ipfs/cid/p");
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("toFiles() keeps throwing clear errors for unsupported sources", async () => {
  await assert.rejects(toFiles(File({ name: "a", src: "./local.txt" })), FileableError);
  await assert.rejects(toFiles(File({ name: "a", cmd: "echo hi" })), /browser/);
});

test("toFiles() throws a clear not-supported error for zip/wbn encodes", async () => {
  await assert.rejects(
    toFiles(Dir({ name: "pkg.zip", encode: "zip", children: File({ name: "a.txt", children: "a" }) })),
    (err: unknown) => err instanceof FileableError && /not supported in the browser/.test((err as Error).message) && /zip/.test((err as Error).message),
  );
  await assert.rejects(
    toFiles(Dir({ name: "pkg.wbn", encode: "wbn", children: File({ name: "a.txt", children: "a" }) })),
    /not supported in the browser/,
  );
});

test("toFiles() accepts explicit encode=\"loose\"", async () => {
  const files = await toFiles(Dir({ name: "d", encode: "loose", children: File({ name: "a", children: "x" }) }));
  assert.deepEqual(files, { "d/a": "x" });
});

test("toFiles() same-build collisions throw", async () => {
  await assert.rejects(toFiles([File({ name: "a", children: "1" }), File({ name: "a", children: "2" })]), FileableError);
});

test("onConflict applies against opts.existing", async () => {
  const existing = { "a.txt": "old", "b.txt": "old", "c.txt": "old", "d.txt": "old" };
  const files = await toFiles(
    [
      File({ name: "a.txt", onConflict: "replace", children: "new" }),
      File({ name: "b.txt", onConflict: "append", children: "new" }),
      File({ name: "c.txt", onConflict: "prepend", children: "new" }),
      File({ name: "d.txt", onConflict: "skip", children: "new" }),
      File({ name: "e.txt", onConflict: "error", children: "new" }),
    ],
    { existing },
  );
  assert.deepEqual(files, {
    "a.txt": "new",
    "b.txt": "oldnew",
    "c.txt": "newold",
    "d.txt": "old",
    "e.txt": "new",
  });
  assert.equal(existing["a.txt"], "old", "existing is not mutated");
  await assert.rejects(
    toFiles(File({ name: "a.txt", onConflict: "error", children: "x" }), { existing }),
    /onConflict="error"/,
  );
  await assert.rejects(toFiles(File({ name: "a.txt", onConflict: "repalce" as never, children: "x" })), FileableError);
});

test("Rm removes matching files from opts.existing (and is a no-op without it)", async () => {
  const existing = { "dist/a.js": "1", "dist/b.map": "2", "dist/sub/c.js": "3", "keep.txt": "4" };
  const files = await toFiles([Rm({ target: "dist/**/*.js" }), File({ name: "new.txt", children: "n" })], { existing });
  assert.deepEqual(files, { "dist/b.map": "2", "keep.txt": "4", "new.txt": "n" });

  const dirs = await toFiles(Rm({ target: "dist", kind: "dir" }), { existing });
  assert.deepEqual(dirs, { "keep.txt": "4" });

  assert.deepEqual(await toFiles([Rm({ target: "x/*", onMissing: "ignore" }), File({ name: "a", children: "a" })]), { a: "a" });
  await assert.rejects(toFiles(Rm({ target: "nothing/*", onMissing: "error" }), { existing }), /matched nothing/);

  const filtered = await toFiles(Rm({ target: "dist/**", deletable: (_info, ctx) => ctx.path.endsWith(".map") }), { existing });
  assert.deepEqual(Object.keys(filtered).sort(), ["dist/a.js", "dist/sub/c.js", "keep.txt"]);
});

test("a freshly generated file is not removed by an Rm in the same tree", async () => {
  const files = await toFiles([Rm({ target: "a.txt" }), File({ name: "a.txt", children: "fresh" })], { existing: { "a.txt": "old" } });
  assert.deepEqual(files, { "a.txt": "fresh" });
});

test("path safety: no .., absolute, backslash, or NUL output paths", async () => {
  for (const name of ["../escape.txt", "a/../../escape.txt", "/abs.txt", "C:/win.txt", "back\\slash.txt", "nul\0.txt"]) {
    await assert.rejects(
      toFiles(File({ name, children: "x" })),
      (err: unknown) => err instanceof FileableError && /unsafe output path/.test((err as Error).message),
      `expected ${JSON.stringify(name)} to be rejected`,
    );
  }
  await assert.rejects(toFiles(Dir({ name: "..", children: File({ name: "x", children: "x" }) })), /unsafe output path/);
  const ok = await toFiles(File({ name: "a/./b/../c.txt", children: "x" }));
  assert.deepEqual(Object.keys(ok), ["a/c.txt"]);
  for (const key of Object.keys(ok)) assert.doesNotMatch(key, /^\/|\.\.|\0|\\/);
});

test("a path named __proto__ cannot pollute the result", async () => {
  const files = await toFiles(File({ name: "__proto__", children: "x" }));
  assert.equal(Object.getPrototypeOf(files), Object.prototype);
  assert.deepEqual(Object.keys(files), ["__proto__"]);
});

test("symlinks are materialized as copies", async () => {
  const target = File({ name: "real.txt", children: "payload" });
  const files = await toFiles([target, File({ name: "link.txt", symlink: target })]);
  assert.equal(files["link.txt"], "payload");
});

test("toFiles() does not mutate the input tree and is repeatable", async () => {
  const tree = Dir({ name: "d", children: File({ name: "a", children: "x" }) });
  assert.deepEqual(await toFiles(tree), await toFiles(tree));
});

test("builders: h(), dir(), file(), rm() produce the same result as JSX components", async () => {
  const viaH = h(Dir, { name: "site" }, h(File, { name: "index.html" }, "<h1>", "hi", "</h1>"), h(File, { name: "a.txt", mode: "644" }, "a"));
  const viaBuilders = dir("site", [file("index.html", ["<h1>", "hi", "</h1>"]), file("a.txt", "a", { mode: "644" })]);
  const expected = { "site/index.html": "<h1>hi</h1>", "site/a.txt": "a" };
  assert.deepEqual(await toFiles(viaH), expected);
  assert.deepEqual(await toFiles(viaBuilders), expected);
  assert.deepEqual(await toFiles(rm("x/*", { onMissing: "ignore" })), {});
});

test("h() builds markup elements and fragments, and rejects reserved lowercase tags", async () => {
  const files = await toFiles(file("p.html", h("p", { class: "x" }, "hi")));
  assert.match(files["p.html"] as string, /<p class="x">hi<\/p>/);
  const frag = await toFiles(file("f.txt", h(Fragment, null, h("b", null, "a"), h("i", null, "b"))));
  assert.equal(frag["f.txt"], "<b>a</b><i>b</i>");
  assert.throws(() => h("file", { name: "x" }), FileableError);
});

test("main entry exports toFiles and the builders for parity", () => {
  assert.equal(main.toFiles, toFiles);
  assert.equal(main.h, h);
  assert.equal(main.dir, dir);
  assert.equal(main.file, file);
  assert.equal(main.rm, rm);
});

test("toFiles() rejects binary (Uint8Array) children instead of writing 'comma,joined,numbers'", async () => {
  await assert.rejects(
    () => toFiles(file("x.bin", [new Uint8Array([1, 2, 3])] as never)),
    /binary content .*base64/,
  );
});
