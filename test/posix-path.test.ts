/**
 * Verifies src/posix-path.ts (the browser-safe `node:path/posix` reimplementation
 * introduced for issue #6) against real `node:path/posix` output -- not just a
 * handful of hand-picked examples, but every combination of a broad set of
 * path fragments (absolute/relative, dot-segments, trailing slashes, `..`
 * climbing past the root, empty strings) that this codebase's own usage in
 * layout.ts could plausibly produce.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import realPosix from "node:path/posix";
import * as fakePosix from "../src/posix-path.js";

const JOIN_FRAGMENTS = [
  "",
  ".",
  "..",
  "a",
  "a/",
  "/a",
  "a/b",
  "a/b/",
  "/a/b",
  "a/./b",
  "a/../b",
  "../a",
  "../../a",
  "a/b/../../c",
  "assets",
  "docs.zip",
  "index.html",
  "img/logo.png",
  "!draft.html",
];

test("join() matches node:path/posix.join() for every pair of fragments", () => {
  for (const a of JOIN_FRAGMENTS) {
    for (const b of JOIN_FRAGMENTS) {
      assert.equal(fakePosix.join(a, b), realPosix.join(a, b), `join(${JSON.stringify(a)}, ${JSON.stringify(b)})`);
    }
  }
});

test("join() matches node:path/posix.join() for triples and edge-case arities", () => {
  const triples: [string, string, string][] = [
    ["a", "b", "c"],
    ["", "a", "b"],
    ["a", "", "b"],
    ["a", "b", ""],
    ["/a", "../b", "c"],
    ["site", "docs.zip", "index.html"],
  ];
  for (const t of triples) {
    assert.equal(fakePosix.join(...t), realPosix.join(...t), `join(${JSON.stringify(t)})`);
  }
  assert.equal(fakePosix.join(), realPosix.join());
  assert.equal(fakePosix.join(""), realPosix.join(""));
});

const DIRNAME_INPUTS = [
  "",
  ".",
  "a",
  "a/",
  "/a",
  "/",
  "a/b",
  "a/b/",
  "a/b/c",
  "/a/b/c",
  "/a/b/c/",
  "a//b",
  "..",
  "../a",
];

test("dirname() matches node:path/posix.dirname() for every sample input", () => {
  for (const input of DIRNAME_INPUTS) {
    assert.equal(fakePosix.dirname(input), realPosix.dirname(input), `dirname(${JSON.stringify(input)})`);
  }
});

const RELATIVE_PAIRS: [string, string][] = [
  [".", "a"],
  ["a", "a/b"],
  ["a/b", "a/c"],
  ["a/b/c", "a"],
  ["", "a"],
  ["a", ""],
  ["a", "a"],
  ["a/b", "a/b"],
  ["a/b/c", "a/b/d"],
  ["site", "site/docs.zip"],
  ["site/docs", "site/assets/img.png"],
  ["a/b/c/d", "a/x/y"],
  [".", "."],
  ["a", "b"],
];

test("relative() matches node:path/posix.relative() for every sample pair (both directions)", () => {
  for (const [from, to] of RELATIVE_PAIRS) {
    assert.equal(fakePosix.relative(from, to), realPosix.relative(from, to), `relative(${JSON.stringify(from)}, ${JSON.stringify(to)})`);
    assert.equal(fakePosix.relative(to, from), realPosix.relative(to, from), `relative(${JSON.stringify(to)}, ${JSON.stringify(from)})`);
  }
});

test("realistic layout.ts usage: join(basePath, name) then relative(dirname(outputPath), targetOutputPath)", () => {
  const basePaths = ["", "site", "site/docs", "site/assets/img"];
  const names = ["index.html", "about.html", "img/logo.png"];
  for (const base of basePaths) {
    for (const name of names) {
      const real = realPosix.join(base, name);
      const fake = fakePosix.join(base, name);
      assert.equal(fake, real, `join(${JSON.stringify(base)}, ${JSON.stringify(name)})`);
    }
  }
  const outputPaths = ["index.html", "about/index.html", "assets/img/logo.png"];
  for (const from of outputPaths) {
    for (const to of outputPaths) {
      const realRel = realPosix.relative(realPosix.dirname(from), to);
      const fakeRel = fakePosix.relative(fakePosix.dirname(from), to);
      assert.equal(fakeRel, realRel, `relative(dirname(${from}), ${to})`);
    }
  }
});
