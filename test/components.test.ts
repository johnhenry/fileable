import { test } from "node:test";
import assert from "node:assert/strict";
import { Dir, File, Rm } from "../src/components.js";

test("File/Dir/Rm are callable directly as plain functions, no JSX needed", () => {
  assert.deepEqual(File({ name: "a.txt" }), { tag: "file", props: { name: "a.txt" }, children: [] });
  assert.deepEqual(Dir({ name: "out" }), { tag: "dir", props: { name: "out" }, children: [] });
  assert.deepEqual(Rm({ target: "*.draft.html" }), { tag: "rm", props: { target: "*.draft.html" }, children: [] });
});

test("File/Dir preserve children the same way the lowercase tags do", () => {
  const file = File({ name: "a.txt", children: "hello" });
  assert.deepEqual(file.children, ["hello"]);
});
