import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "../src/build.js";
import { FRAGMENT } from "../src/types.js";
import type { Descriptor } from "../src/types.js";

function file(name: string, children: unknown[] = []): Descriptor {
  return { tag: "file", props: { name }, children: children as never };
}

test("flattens fragments into the parent's children", () => {
  const fragment: Descriptor = { tag: FRAGMENT, props: {}, children: [file("a.txt"), file("b.txt")] };
  const [root] = build({ tag: "dir", props: { name: "root" }, children: [fragment] });
  assert.equal(root.children.length, 2);
});

test("flattens nested arrays from .map()", () => {
  const nested = [file("a.txt"), [file("b.txt"), [file("c.txt")]]];
  const [root] = build({ tag: "dir", props: { name: "root" }, children: nested });
  assert.equal(root.children.length, 3);
});

test("drops null/undefined/boolean children", () => {
  const [root] = build({
    tag: "dir",
    props: { name: "root" },
    children: [null, undefined, false, true, file("a.txt")],
  });
  assert.equal(root.children.length, 1);
});

test("coerces number children to strings", () => {
  const [root] = build({ tag: "file", props: { name: "a.txt" }, children: [1, 2, 3] });
  assert.deepEqual(root.children, ["1", "2", "3"]);
});

test("assigns a stable __id to every descriptor", () => {
  const [root] = build({ tag: "dir", props: { name: "root" }, children: [file("a.txt")] });
  assert.ok(root.__id);
  const child = root.children[0] as Descriptor;
  assert.ok(child.__id);
  assert.notEqual(root.__id, child.__id);
});
