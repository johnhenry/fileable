import { test } from "node:test";
import assert from "node:assert/strict";
import { parseVarFlag } from "../bin/vars.js";

test("no type annotation defaults to string", () => {
  assert.deepEqual(parseVarFlag("title=Hello World"), ["title", "Hello World"]);
});

test(":number coerces to a real number", () => {
  assert.deepEqual(parseVarFlag("count:number=3"), ["count", 3]);
  assert.deepEqual(parseVarFlag("pi:number=3.14"), ["pi", 3.14]);
});

test(":boolean coerces true/false case-insensitively", () => {
  assert.deepEqual(parseVarFlag("draft:boolean=true"), ["draft", true]);
  assert.deepEqual(parseVarFlag("draft:boolean=FALSE"), ["draft", false]);
});

test("no \"=value\" is shorthand for true, with or without an explicit :boolean", () => {
  assert.deepEqual(parseVarFlag("draft"), ["draft", true]);
  assert.deepEqual(parseVarFlag("draft:boolean"), ["draft", true]);
});

test(":json parses arbitrary JSON values", () => {
  assert.deepEqual(parseVarFlag('tags:json=["a","b"]'), ["tags", ["a", "b"]]);
  assert.deepEqual(parseVarFlag('config:json={"x":1}'), ["config", { x: 1 }]);
});

test("an invalid number throws a clear error", () => {
  assert.throws(() => parseVarFlag("count:number=abc"), /"abc" is not a valid number/);
});

test("an invalid boolean throws a clear error", () => {
  assert.throws(() => parseVarFlag("draft:boolean=yes"), /"yes" is not "true" or "false"/);
});

test("invalid JSON throws a clear error", () => {
  assert.throws(() => parseVarFlag("tags:json={not valid"), /not valid JSON/);
});

test("a non-boolean type with no \"=value\" throws instead of guessing", () => {
  assert.throws(() => parseVarFlag("count:number"), /requires a value/);
});

test("an unknown type throws a clear error", () => {
  assert.throws(() => parseVarFlag("x:regexp=foo"), /unknown type "regexp"/);
});

test("an empty key throws", () => {
  assert.throws(() => parseVarFlag("=value"), /expected key\[:type\]=value/);
});
