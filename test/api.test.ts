import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { glob, linkTo, useCollection, warn } from "../src/api.js";
import { drainBuildContext } from "../src/context.js";
import { isLinkRef } from "../src/types.js";
import type { Descriptor } from "../src/types.js";

const fixtures = join(process.cwd(), "test/fixtures");

test("linkTo() returns a LinkRef marker, not a literal string, carrying its target and options", () => {
  const target: Descriptor = { tag: "file", props: { name: "other.html" }, children: [] };
  const ref = linkTo(target, { format: "markdown", text: "Other" });
  assert.ok(isLinkRef(ref));
  const marker = ref as unknown as { target: Descriptor; options?: { format?: string; text?: string } };
  assert.equal(marker.target, target);
  assert.deepEqual(marker.options, { format: "markdown", text: "Other" });
});

test("glob() returns matches without registering a collection dependency", () => {
  drainBuildContext();
  const matches = glob(join(fixtures, "*.txt"));
  assert.ok(matches.length >= 1);
  const { collectionPatterns } = drainBuildContext();
  assert.equal(collectionPatterns.length, 0);
});

test("useCollection() returns the same matches and registers a dependency", () => {
  drainBuildContext();
  const pattern = join(fixtures, "*.txt");
  const matches = useCollection(pattern);
  assert.ok(matches.length >= 1);
  const { collectionPatterns } = drainBuildContext();
  assert.deepEqual(collectionPatterns, [pattern]);
});

test("warn() queues a message that render() drains and flushes once", () => {
  drainBuildContext();
  warn("careful now");
  const { warnings } = drainBuildContext();
  assert.deepEqual(warnings, ["careful now"]);
  assert.deepEqual(drainBuildContext().warnings, []);
});
