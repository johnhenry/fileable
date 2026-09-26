/**
 * src/browser/index.ts's `plan()` (issue #6): runs Build -> Resolve ->
 * Layout -> Hash for real, without ever writing, using the browser-safe
 * resolve()/hash() from src/browser/. Exercises the fetch-based `src`
 * paths (the same local-HTTP-server pattern test/ipfs.test.ts and
 * test/resolve.test.ts already use), the explicit "unsupported in the
 * browser" errors, and the new/changed/cached classification against a
 * previous lock.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { plan, toLockFileShape } from "../src/browser/index.js";
import { FileableError } from "../src/types.js";
import type { Descriptor } from "../src/types.js";

async function withServer(
  handler: (path: string) => { status: number; body: string },
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server: Server = createServer((req, res) => {
    const { status, body } = handler(req.url ?? "/");
    res.writeHead(status);
    res.end(body);
  });
  await new Promise<void>((resolvePromise) => server.listen(0, resolvePromise));
  const port = (server.address() as { port: number }).port;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
  }
}

test("plan() resolves a plain text tree (base64 + inline children) and reports every artifact as new with no previous lock", async () => {
  const tree: Descriptor[] = [
    {
      tag: "dir",
      props: { name: "site" },
      children: [
        { tag: "file", props: { name: "index.html" }, children: ["<h1>hi</h1>"] },
        { tag: "file", props: { name: "logo.txt", base64: Buffer.from("logo bytes").toString("base64") }, children: [] },
      ],
    },
  ];
  const result = await plan(tree);
  assert.equal(result.artifacts.length, 3); // dir + 2 files
  for (const artifact of result.artifacts) {
    assert.equal(artifact.status, "new");
    assert.ok(artifact.hash.startsWith("sha256:"));
  }
  const index = result.artifacts.find((a) => a.outputPath === "site/index.html")!;
  assert.equal(index.content, "<h1>hi</h1>");
  const logo = result.artifacts.find((a) => a.outputPath === "site/logo.txt")!;
  // "logo bytes" is plain ASCII, so it round-trips as UTF-8 text and stays a
  // string (bufferToContent's binary-vs-text decision, matching src/content-util.ts's
  // Node behavior exactly -- see test/browser-content-util.test.ts).
  assert.equal(logo.content, "logo bytes");
});

test("plan() fetches an https:// src via the browser-safe resolve(), same as the Node pipeline's src= does", async () => {
  await withServer(
    (path) => (path === "/hello.txt" ? { status: 200, body: "hello from the network" } : { status: 404, body: "" }),
    async (baseUrl) => {
      const tree: Descriptor = { tag: "file", props: { name: "out.txt", src: `${baseUrl}/hello.txt` }, children: [] };
      const result = await plan(tree);
      assert.equal(result.artifacts[0].content, "hello from the network");
    },
  );
});

test("plan() supports a thenable src (an already-resolved-in-memory Promise<string>)", async () => {
  const tree: Descriptor = { tag: "file", props: { name: "out.txt", src: Promise.resolve("from memory") }, children: [] };
  const result = await plan(tree);
  assert.equal(result.artifacts[0].content, "from memory");
});

test("plan() classifies unchanged/changed/new artifacts against a previous lock", async () => {
  const buildTree = (text: string): Descriptor[] => [
    { tag: "file", props: { name: "a.txt" }, children: [text] },
    { tag: "file", props: { name: "b.txt" }, children: ["always the same"] },
  ];

  const first = await plan(buildTree("v1"));
  assert.ok(first.artifacts.every((a) => a.status === "new"));
  const lock = toLockFileShape(first.artifacts);

  const second = await plan(buildTree("v2"), {}, lock);
  const a = second.artifacts.find((x) => x.outputPath === "a.txt")!;
  const b = second.artifacts.find((x) => x.outputPath === "b.txt")!;
  assert.equal(a.status, "changed");
  assert.equal(b.status, "cached");

  const third = await plan([...buildTree("v2"), { tag: "file", props: { name: "c.txt" }, children: ["new file"] }], {}, lock);
  const c = third.artifacts.find((x) => x.outputPath === "c.txt")!;
  assert.equal(c.status, "new");
});

test("plan() throws a clear, Node-entry-point-pointing error for a local filesystem src (no real fs in the browser)", async () => {
  const tree: Descriptor = { tag: "file", props: { name: "out.txt", src: "./some/local/file.txt" }, children: [] };
  await assert.rejects(plan(tree), (err: unknown) => {
    assert.ok(err instanceof FileableError);
    assert.match((err as Error).message, /Node entry point/);
    return true;
  });
});

test("plan() throws a clear error for `cmd` (no child_process in the browser)", async () => {
  const tree: Descriptor = { tag: "file", props: { name: "out.txt", cmd: "echo hi" }, children: [] };
  await assert.rejects(plan(tree), (err: unknown) => {
    assert.ok(err instanceof FileableError);
    assert.match((err as Error).message, /Node entry point/);
    return true;
  });
});

test("plan() throws a clear error for `<Dir from=\"glob\">` (no fs/glob in the browser)", async () => {
  const tree: Descriptor = { tag: "dir", props: { name: "site", from: "*.txt" }, children: [] };
  await assert.rejects(plan(tree), (err: unknown) => {
    assert.ok(err instanceof FileableError);
    assert.match((err as Error).message, /Node entry point/);
    return true;
  });
});

test("plan() never writes anything -- removals are reported, not applied", async () => {
  const tree: Descriptor = { tag: "rm", props: { target: "!README.md" }, children: [] };
  const result = await plan(tree);
  assert.equal(result.removals.length, 1);
});
