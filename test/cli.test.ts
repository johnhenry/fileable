import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../bin/fileable.js";

const fixtureTemplate = join(process.cwd(), "test/fixtures/cli-template.js");

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "fileable-cli-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("`fileable build <template>` renders the default export into --out-dir", async () => {
  await withTempDir(async (outDir) => {
    const code = await main(["build", fixtureTemplate, "--out-dir", outDir, "--no-cache"]);
    assert.equal(code, 0);
    const content = await readFile(join(outDir, "out/hello.txt"), "utf8");
    assert.equal(content, "Hello from CLI");
  });
});

test("--out-dir defaults to the template file's own directory", async () => {
  const outDir = join(process.cwd(), "test/fixtures/out");
  try {
    const code = await main(["build", fixtureTemplate, "--no-cache"]);
    assert.equal(code, 0);
    const content = await readFile(join(outDir, "hello.txt"), "utf8");
    assert.equal(content, "Hello from CLI");
  } finally {
    await rm(outDir, { recursive: true, force: true });
    await rm(join(process.cwd(), "test/fixtures/.fileable-lock.json"), { force: true });
  }
});

test("--help returns 0 without requiring a template", async () => {
  assert.equal(await main(["--help"]), 0);
  assert.equal(await main(["build", "--help"]), 0);
});

test("no command / unknown command returns 1", async () => {
  assert.equal(await main([]), 1);
  assert.equal(await main(["frobnicate"]), 1);
});

test("`build` with no template path returns 1", async () => {
  assert.equal(await main(["build"]), 1);
});

test("a nonexistent template module returns 1", async () => {
  assert.equal(await main(["build", "does-not-exist.js"]), 1);
});

test("a template module with no default export returns 1", async () => {
  await withTempDir(async (outDir) => {
    const template = join(process.cwd(), "test/fixtures/no-default-export.js");
    const code = await main(["build", template, "--out-dir", outDir]);
    assert.equal(code, 1);
  });
});

test("the compiled bin/fileable.js is directly executable via node (shebang + real process)", async () => {
  await withTempDir(async (outDir) => {
    const cliPath = join(process.cwd(), "dist/bin/fileable.js");
    const output = execFileSync(
      process.execPath,
      [cliPath, "build", fixtureTemplate, "--out-dir", outDir, "--no-cache"],
      { encoding: "utf8" },
    );
    assert.match(output, /write out\/hello\.txt/);
    assert.match(output, /2 written, 0 skipped, 0 removed/);
    const content = await readFile(join(outDir, "out/hello.txt"), "utf8");
    assert.equal(content, "Hello from CLI");
  });
});
