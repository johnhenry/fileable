import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { bufferToContent, combineContent, isUtf8Text } from "../src/content-util.js";

const pngPath = join(process.cwd(), "test/fixtures/logo.png");

test("isUtf8Text is true for plain text bytes", () => {
  assert.equal(isUtf8Text(Buffer.from("Hello, world!\n", "utf8")), true);
});

test("isUtf8Text is false for a real binary file (PNG)", async () => {
  const png = await readFile(pngPath);
  assert.equal(isUtf8Text(png), false);
});

test("bufferToContent returns a string for text bytes, a Buffer for binary bytes", async () => {
  assert.equal(bufferToContent(Buffer.from("plain text", "utf8")), "plain text");
  const png = await readFile(pngPath);
  const result = bufferToContent(png);
  assert.ok(Buffer.isBuffer(result));
  assert.ok((result as Buffer).equals(png));
});

test("combineContent concatenates two strings as a string (unchanged prior behavior)", () => {
  assert.equal(combineContent("a", "b"), "ab");
  assert.equal(combineContent(undefined, "b"), "b");
});

test("combineContent falls back to a byte-level Buffer.concat when either side is binary", async () => {
  const png = await readFile(pngPath);
  const combined = combineContent("prefix:", png) as Buffer;
  assert.ok(Buffer.isBuffer(combined));
  assert.ok(combined.subarray(0, 7).equals(Buffer.from("prefix:", "utf8")));
  assert.ok(combined.subarray(7).equals(png));
});
