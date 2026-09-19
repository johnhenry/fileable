import { test } from "node:test";
import assert from "node:assert/strict";
import { layout } from "../src/layout.js";
import { hash } from "../src/hash.js";
import type { Descriptor } from "../src/types.js";

test("identical content produces identical hashes for two independently-authored artifacts", () => {
  // PRD SS5.4: the same descriptor instance must never appear twice, so reuse
  // is done by calling a function twice -- each call makes a fresh object.
  const Footer = (): Descriptor => ({ tag: "file", props: {}, children: ["shared footer"] });
  const a: Descriptor = { tag: "file", props: { name: "a.html" }, children: [Footer()] };
  const b: Descriptor = { tag: "file", props: { name: "b.html" }, children: [Footer()] };
  const result = hash(layout([{ tag: "dir", props: { name: "site" }, children: [a, b] }]));
  const [artifactA, artifactB] = result.artifacts.filter((x) => x.kind === "file");
  assert.notEqual(artifactA.id, artifactB.id);
  assert.equal(artifactA.hash, artifactB.hash);
});

test("changing an inlined partial's content changes the parent's hash", () => {
  const build = (footerText: string) => {
    const footer: Descriptor = { tag: "file", props: {}, children: [footerText] };
    const page: Descriptor = { tag: "file", props: { name: "page.html" }, children: ["BODY", footer] };
    return hash(layout([page])).artifacts[0];
  };
  const original = build("footer v1");
  const changed = build("footer v2");
  assert.notEqual(original.hash, changed.hash);
});

test("useCollection dependency patterns are folded into every artifact's hash", () => {
  const page: Descriptor = { tag: "file", props: { name: "page.html" }, children: ["BODY"] };
  const withoutCollection = hash(layout([page])).artifacts[0];
  const withCollection = hash(layout([page]), ["content/posts/*.md"]).artifacts[0];
  assert.notEqual(withoutCollection.hash, withCollection.hash);
  assert.deepEqual(withCollection.dependsOn, ["content/posts/*.md (collection)"]);
});

test("an archive root's hash changes when any descendant's content changes", () => {
  const build = (text: string) => {
    const file: Descriptor = { tag: "file", props: { name: "x.txt" }, children: [text] };
    const dir: Descriptor = { tag: "dir", props: { name: "out", as: "archive" }, children: [file] };
    return hash(layout([dir])).artifacts.find((a) => a.kind === "dir")!;
  };
  assert.notEqual(build("v1").hash, build("v2").hash);
});

test("an archive root's hash detects two files swapping content (path must bind to hash, not just a bag of hashes)", () => {
  const build = (aContent: string, bContent: string) => {
    const a: Descriptor = { tag: "file", props: { name: "a.txt" }, children: [aContent] };
    const b: Descriptor = { tag: "file", props: { name: "b.txt" }, children: [bContent] };
    const dir: Descriptor = { tag: "dir", props: { name: "out", as: "archive" }, children: [a, b] };
    return hash(layout([dir])).artifacts.find((x) => x.kind === "dir")!;
  };
  // Same multiset of file contents ("X", "Y"), swapped across paths.
  const before = build("X", "Y");
  const after = build("Y", "X");
  assert.notEqual(before.hash, after.hash);
});

test("changing a file's mode invalidates its hash (Write only re-chmods a file it actually rewrites)", () => {
  const build = (mode: string) => {
    const file: Descriptor = { tag: "file", props: { name: "run.sh", mode }, children: ["#!/bin/sh"] };
    return hash(layout([file])).artifacts[0];
  };
  assert.notEqual(build("0644").hash, build("0755").hash);
});

test(".fileable-lock.json keys by artifact id, not outputPath, so sibling archives with the same relative path don't collide", () => {
  const makeArchive = (name: string, text: string): Descriptor => ({
    tag: "dir",
    props: { name, as: "archive" },
    children: [{ tag: "file", props: { name: "index.html" }, children: [text] }],
  });
  const site: Descriptor = { tag: "dir", props: { name: "site" }, children: [makeArchive("docs", "DOCS"), makeArchive("assets", "ASSETS")] };
  const result = hash(layout([site]));
  const docsIndex = result.artifacts.find((a) => a.outputPath === "index.html" && a.id.startsWith("site/docs.zip"))!;
  const assetsIndex = result.artifacts.find((a) => a.outputPath === "index.html" && a.id.startsWith("site/assets.zip"))!;
  assert.notEqual(docsIndex.id, assetsIndex.id);
  assert.notEqual(docsIndex.hash, assetsIndex.hash);
});
