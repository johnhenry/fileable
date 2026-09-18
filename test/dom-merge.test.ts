import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeHtmlFragments } from "../src/dom-merge.js";

test("plain snippets with no document shell are concatenated as body content", () => {
  const result = mergeHtmlFragments(["<h1>A</h1>", "<p>B</p>"]);
  assert.equal(result, "<h1>A</h1><p>B</p>");
});

test("full-document fragments are merged into one shared head/body", () => {
  const header = "<html><head><title>T</title></head><body><header>H</header></body></html>";
  const footer = "<html><body><footer>F</footer></body></html>";
  const result = mergeHtmlFragments([header, "<main>M</main>", footer]);
  assert.match(result, /<title>T<\/title>/);
  assert.match(result, /<header>H<\/header>/);
  assert.match(result, /<main>M<\/main>/);
  assert.match(result, /<footer>F<\/footer>/);
  assert.equal(result.match(/<html>/g)?.length, 1);
});
