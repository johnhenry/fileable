import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { resolve } from "../src/resolve.js";
import { FileableError } from "../src/types.js";
import type { Descriptor } from "../src/types.js";

const fixtures = join(process.cwd(), "test/fixtures");

test("reads a plain-text src file into __resolvedContent", async () => {
  const node: Descriptor = { tag: "file", props: { name: "out.txt", src: "hello.txt" }, children: [] };
  const [resolved] = await resolve([node], { cwd: fixtures });
  assert.equal((resolved.props as { __resolvedContent?: string }).__resolvedContent, "Hello from a file\n");
});

test("imports a code src file's default export as inlined children", async () => {
  const node: Descriptor = { tag: "file", props: { name: "out.html", src: "partial.js" }, children: [] };
  const [resolved] = await resolve([node], { cwd: fixtures });
  assert.equal(resolved.children.length, 1);
  const child = resolved.children[0] as Descriptor;
  assert.equal(child.tag, "file");
  assert.deepEqual(child.children, ["partial content"]);
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
