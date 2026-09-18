import { test } from "node:test";
import assert from "node:assert/strict";
import { markdown } from "../src/markdown.js";

test("renders basic markdown constructs to HTML", () => {
  const html = markdown("# Title\n\nSome **bold** and *italic* text.");
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<em>italic<\/em>/);
});

test("renders lists and links", () => {
  const html = markdown("- one\n- two\n\n[home](/)");
  assert.match(html, /<li>one<\/li>/);
  assert.match(html, /<li>two<\/li>/);
  assert.match(html, /<a href="\/">home<\/a>/);
});

test("renders fenced code blocks", () => {
  const html = markdown("```js\nconst x = 1;\n```");
  assert.match(html, /<pre><code/);
  assert.match(html, /const x = 1;/);
});

test("returns a plain string synchronously, usable directly in JSX content", () => {
  const result = markdown("plain text");
  assert.equal(typeof result, "string");
  assert.match(result, /<p>plain text<\/p>/);
});
