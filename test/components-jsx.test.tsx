import { test } from "node:test";
import assert from "node:assert/strict";
import { Dir, File, Rm } from "../src/components.js";
import { build } from "../src/build.js";
import { layout } from "../src/layout.js";
import { FileableError } from "../src/types.js";

test("<File>/<Dir>/<Rm> used as JSX tags produce a real structural tree", () => {
  const [root] = build(
    <Dir name="site">
      <File name="a.html">A</File>
      <Rm target="*.draft.html" />
    </Dir>,
  );
  const result = layout([root]);
  const fileArtifact = result.artifacts.find((a) => a.kind === "file")!;
  assert.equal(fileArtifact.outputPath, "site/a.html");
  assert.equal(fileArtifact.content, "A");
  assert.deepEqual(result.removals, ["site/*.draft.html"]);
});

test("<File>/<Dir> nest and inline exactly like the primitives always did (nameless inlining still applies)", () => {
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

test("bare lowercase <dir>/<file>/<rm> are reserved and throw, pointing at the capitalized import", () => {
  // Bypass the JSX intrinsic-tag rule (which would statically resolve to the
  // lowercase string anyway) via an `any`-typed variable holding the tag
  // name, so this exercises jsx()'s runtime guard through real JSX syntax
  // rather than calling jsx() as a plain function.
  const Dir_ = "dir" as unknown as typeof Dir;
  const File_ = "file" as unknown as typeof File;
  const Rm_ = "rm" as unknown as typeof Rm;

  assert.throws(() => <Dir_ name="site" />, (error: unknown) => {
    assert.ok(error instanceof FileableError);
    assert.match(error.message, /import \{ Dir \} from "fileable"/);
    return true;
  });
  assert.throws(() => <File_ name="a.html" />, (error: unknown) => {
    assert.ok(error instanceof FileableError);
    assert.match(error.message, /import \{ File \} from "fileable"/);
    return true;
  });
  assert.throws(() => <Rm_ target="*.draft.html" />, (error: unknown) => {
    assert.ok(error instanceof FileableError);
    assert.match(error.message, /import \{ Rm \} from "fileable"/);
    return true;
  });
});
