import { test } from "node:test";
import assert from "node:assert/strict";
import { Dir, File, Rm } from "../src/components.js";
import { FILEABLE_DESCRIPTOR } from "../src/types.js";

test("File/Dir/Rm are callable directly as plain functions, no JSX needed", () => {
  assert.deepEqual(File({ name: "a.txt" }), {
    tag: "file",
    props: { name: "a.txt" },
    children: [],
    [FILEABLE_DESCRIPTOR]: true,
  });
  assert.deepEqual(Dir({ name: "out" }), {
    tag: "dir",
    props: { name: "out" },
    children: [],
    [FILEABLE_DESCRIPTOR]: true,
  });
  assert.deepEqual(Rm({ target: "*.draft.html" }), {
    tag: "rm",
    props: { target: "*.draft.html" },
    children: [],
    [FILEABLE_DESCRIPTOR]: true,
  });
});

test("every descriptor File/Dir/Rm produce carries the FILEABLE_DESCRIPTOR brand", () => {
  // A global-symbol-registry marker, not a shape check -- lets a consumer
  // like servable recognize a fileable descriptor appearing as a raw JSX
  // child without duck-typing {tag,props,children}, which every descriptor
  // from any package built the same way also has.
  assert.equal(File({ name: "a.txt" })[FILEABLE_DESCRIPTOR], true);
  assert.equal(Dir({ name: "out" })[FILEABLE_DESCRIPTOR], true);
  assert.equal(Rm({ target: "*.draft.html" })[FILEABLE_DESCRIPTOR], true);
});

test("File/Dir preserve children the same way the lowercase tags do", () => {
  const file = File({ name: "a.txt", children: "hello" });
  assert.deepEqual(file.children, ["hello"]);
});
