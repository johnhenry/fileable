/**
 * Verifies src/browser/hash.ts (issue #6's Web Crypto-based Stage 4) produces
 * byte-identical digests to src/hash.ts (node:crypto-based) -- both the raw
 * SHA-256 primitive in isolation, and the full artifact-hash pipeline run on
 * an identical layout tree. This is the load-bearing guarantee the issue
 * asked to verify empirically, not assume: anything relying on the hash for
 * cache/change detection (a `.fileable-lock.json` written by the Node
 * pipeline) needs the browser pipeline's hashes to match exactly, or an
 * existing on-disk lock file would spuriously invalidate every artifact the
 * moment a caller cross-checks it from the browser-safe side.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { layout } from "../src/layout.js";
import { hash as nodeHash } from "../src/hash.js";
import { hash as webHash } from "../src/browser/hash.js";
import type { Descriptor } from "../src/types.js";

test("raw SHA-256 digest: node:crypto and Web Crypto agree on plain text", async () => {
  const samples = ["", "hello world", "a".repeat(10_000), "unicode: éèê中文😀", "line1\nline2\nline3"];
  for (const text of samples) {
    const nodeDigest = createHash("sha256").update(text, "utf8").digest("hex");
    const webDigest = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))).toString("hex");
    assert.equal(webDigest, nodeDigest, `digest mismatch for ${JSON.stringify(text.slice(0, 30))}`);
  }
});

test("raw SHA-256 digest: node:crypto and Web Crypto agree on binary bytes", async () => {
  const buffers = [
    Buffer.alloc(0),
    Buffer.from([0, 1, 2, 3, 255, 254, 253]),
    Buffer.from(Array.from({ length: 4096 }, (_, i) => i % 256)),
  ];
  for (const buf of buffers) {
    const nodeDigest = createHash("sha256").update(buf).digest("hex");
    const webDigest = Buffer.from(await crypto.subtle.digest("SHA-256", buf)).toString("hex");
    assert.equal(webDigest, nodeDigest, `digest mismatch for a ${buf.length}-byte buffer`);
  }
});

test("node:crypto incremental .update(a).update(b) equals Web Crypto's one-shot digest(a+b) -- the technique hash.ts vs. browser/hash.ts each rely on", async () => {
  const a = "BODY content, first half. ";
  const b = "second half, appended as a separate chunk.";
  const nodeDigest = createHash("sha256").update(a).update(b).digest("hex");
  const combined = new TextEncoder().encode(a + b);
  const webDigest = Buffer.from(await crypto.subtle.digest("SHA-256", combined)).toString("hex");
  assert.equal(webDigest, nodeDigest);
});

test("full pipeline: hash.ts and browser/hash.ts produce identical artifact hashes for an identical tree", async () => {
  const buildTree = (): Descriptor[] => [
    {
      tag: "dir",
      props: { name: "site" },
      children: [
        { tag: "file", props: { name: "index.html" }, children: ["<h1>hi</h1>"] },
        {
          tag: "dir",
          props: { name: "assets" },
          children: [{ tag: "file", props: { name: "style.css", mode: "0644" }, children: ["body{color:red}"] }],
        },
      ],
    },
  ];

  const nodeResult = nodeHash(layout(buildTree()), ["content/posts/*.md"]);
  const webResult = await webHash(layout(buildTree()), ["content/posts/*.md"]);

  assert.equal(nodeResult.artifacts.length, webResult.artifacts.length);
  const nodeById = new Map(nodeResult.artifacts.map((a) => [a.id, a]));
  const webById = new Map(webResult.artifacts.map((a) => [a.id, a]));
  for (const [id, nodeArtifact] of nodeById) {
    const webArtifact = webById.get(id);
    assert.ok(webArtifact, `browser/hash.ts produced no artifact for id ${id}`);
    assert.equal(webArtifact!.hash, nodeArtifact.hash, `hash mismatch for artifact ${id}`);
    assert.deepEqual(webArtifact!.dependsOn, nodeArtifact.dependsOn);
  }
});

test("full pipeline: an archive root's aggregate hash also matches between hash.ts and browser/hash.ts", async () => {
  const buildTree = (aContent: string, bContent: string): Descriptor[] => [
    {
      tag: "dir",
      props: { name: "out", encode: "zip" },
      children: [
        { tag: "file", props: { name: "a.txt" }, children: [aContent] },
        { tag: "file", props: { name: "b.txt" }, children: [bContent] },
      ],
    },
  ];

  const nodeResult = nodeHash(layout(buildTree("X", "Y")));
  const webResult = await webHash(layout(buildTree("X", "Y")));
  const nodeRoot = nodeResult.artifacts.find((a) => a.kind === "dir")!;
  const webRoot = webResult.artifacts.find((a) => a.kind === "dir")!;
  assert.equal(webRoot.hash, nodeRoot.hash);

  // And swapping content across paths changes both implementations' aggregate hash identically.
  const nodeSwapped = nodeHash(layout(buildTree("Y", "X"))).artifacts.find((a) => a.kind === "dir")!;
  const webSwapped = (await webHash(layout(buildTree("Y", "X")))).artifacts.find((a) => a.kind === "dir")!;
  assert.notEqual(nodeSwapped.hash, nodeRoot.hash);
  assert.notEqual(webSwapped.hash, webRoot.hash);
  assert.equal(webSwapped.hash, nodeSwapped.hash);
});
