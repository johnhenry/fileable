/**
 * src/browser/content-util.ts (issue #6's Buffer-free content handling)
 * verified both standalone and against ../content-util.ts's real Node
 * behavior for the same inputs, so the two stay behaviorally identical.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as nodeUtil from "../src/content-util.js";
import * as webUtil from "../src/browser/content-util.js";
import { FileableError } from "../src/types.js";

test("decodeBase64Strict: browser and Node decode identical bytes for valid base64", () => {
  const samples = ["", "aGVsbG8=", "aGVsbG8gd29ybGQh", Buffer.from("binary\x00\x01\xff", "binary").toString("base64")];
  for (const b64 of samples) {
    const nodeBytes = nodeUtil.decodeBase64Strict(b64, "<test>");
    const webBytes = webUtil.decodeBase64Strict(b64, "<test>");
    assert.deepEqual(Array.from(webBytes), Array.from(nodeBytes), `mismatch for ${JSON.stringify(b64)}`);
  }
});

test("decodeBase64Strict: browser rejects malformed base64 the same way Node does", () => {
  const bad = "not-valid-base64!!!";
  assert.throws(() => nodeUtil.decodeBase64Strict(bad, "<test>"), FileableError);
  assert.throws(() => webUtil.decodeBase64Strict(bad, "<test>"), FileableError);
});

test("bufferToContent: text round-trips to a string, binary stays raw bytes, on both sides", () => {
  const textBytes = new TextEncoder().encode("plain ASCII/UTF-8 text");
  assert.equal(webUtil.bufferToContent(textBytes), nodeUtil.bufferToContent(Buffer.from(textBytes)));

  const binaryBytes = new Uint8Array([0, 159, 146, 150, 255, 254]); // invalid UTF-8 sequence
  const webResult = webUtil.bufferToContent(binaryBytes);
  const nodeResult = nodeUtil.bufferToContent(Buffer.from(binaryBytes));
  assert.ok(webResult instanceof Uint8Array, "browser binary content should stay a Uint8Array");
  assert.ok(Buffer.isBuffer(nodeResult), "Node binary content should stay a Buffer");
  assert.deepEqual(Array.from(webResult as Uint8Array), Array.from(nodeResult as Buffer));
});

test("combineContent: text+text concatenates as a string; either side binary drops to a byte concat, identically on both sides", () => {
  assert.equal(webUtil.combineContent("foo", "bar"), nodeUtil.combineContent("foo", "bar"));

  const bin = new Uint8Array([1, 2, 3]);
  const webCombined = webUtil.combineContent("foo", bin) as Uint8Array;
  const nodeCombined = nodeUtil.combineContent("foo", Buffer.from(bin)) as Buffer;
  assert.deepEqual(Array.from(webCombined), Array.from(nodeCombined));

  assert.equal(webUtil.combineContent(undefined, "bar"), "bar");
});
