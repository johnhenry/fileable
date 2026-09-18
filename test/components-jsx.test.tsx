import { test } from "node:test";
import assert from "node:assert/strict";
import { Dir, File, Rm } from "../src/components.js";
import { build } from "../src/build.js";
import { layout } from "../src/layout.js";

test("<File>/<Dir>/<Rm> used as JSX tags produce the same tree as the lowercase primitives", () => {
  const capitalized = build(
    <Dir name="site">
      <File name="a.html">A</File>
      <Rm target="*.draft.html" />
    </Dir>,
  );
  const lowercase = build(
    <dir name="site">
      <file name="a.html">A</file>
      <rm target="*.draft.html" />
    </dir>,
  );

  const capitalizedResult = layout(capitalized);
  const lowercaseResult = layout(lowercase);

  assert.deepEqual(
    capitalizedResult.artifacts.map((a) => ({ outputPath: a.outputPath, content: a.content, kind: a.kind })),
    lowercaseResult.artifacts.map((a) => ({ outputPath: a.outputPath, content: a.content, kind: a.kind })),
  );
  assert.deepEqual(capitalizedResult.removals, lowercaseResult.removals);
});

test("<File>/<Dir> nest and inline exactly like <file>/<dir> (nameless inlining still applies)", () => {
  const [root] = build(
    <File name="post.html">
      <File>HEADER</File>
      BODY
    </File>,
  );
  const result = layout([root]);
  assert.equal(result.artifacts.length, 1);
  assert.equal(result.artifacts[0].content, "HEADERBODY");
});
