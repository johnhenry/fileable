import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { glob, useCollection, warn } from "../src/api.js";
import { drainBuildContext } from "../src/context.js";

const fixtures = join(process.cwd(), "test/fixtures");

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
