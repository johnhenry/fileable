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

test("cmd throws without allowExec", async () => {
  const node: Descriptor = { tag: "file", props: { name: "out.txt", cmd: "echo hi" }, children: [] };
  await assert.rejects(() => resolve([node], { cwd: fixtures }), FileableError);
});

test("cmd runs and captures stdout when allowExec is true", async () => {
  const node: Descriptor = { tag: "file", props: { name: "out.txt", cmd: "echo hi" }, children: [] };
  const [resolved] = await resolve([node], { cwd: fixtures, allowExec: true });
  assert.equal((resolved.props as { __resolvedContent?: string }).__resolvedContent?.trim(), "hi");
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
