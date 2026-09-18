import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../bin/fileable.js";

const fixtureTemplate = join(process.cwd(), "test/fixtures/cli-template.js");
const fixtureTemplateFn = join(process.cwd(), "test/fixtures/cli-template-fn.js");

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

test("--var passes typed values into a template function", async () => {
  await withTempDir(async (outDir) => {
    const code = await main([
      "build",
      fixtureTemplateFn,
      "--out-dir",
      outDir,
      "--no-cache",
      "--var",
      "name=Ada",
      "--var",
      "count:number=3",
      "--var",
      "draft:boolean=true",
    ]);
    assert.equal(code, 0);
    const content = await readFile(join(outDir, "out/greeting.txt"), "utf8");
    assert.equal(content, "Hello, Ada! count=3 draft=true");
  });
});

test("a template function with no --var flags gets defaults from the template itself", async () => {
  await withTempDir(async (outDir) => {
    const code = await main(["build", fixtureTemplateFn, "--out-dir", outDir, "--no-cache"]);
    assert.equal(code, 0);
    const content = await readFile(join(outDir, "out/greeting.txt"), "utf8");
    assert.equal(content, "Hello, World! count=0 draft=false");
  });
});

test("an invalid --var returns 1 with a clear message, without importing the template", async () => {
  await withTempDir(async (outDir) => {
    const code = await main(["build", fixtureTemplateFn, "--out-dir", outDir, "--var", "count:number=abc"]);
    assert.equal(code, 1);
  });
});

test("--var on a plain-tree (non-function) template is ignored with a warning, not an error", async () => {
  await withTempDir(async (outDir) => {
    const code = await main(["build", fixtureTemplate, "--out-dir", outDir, "--no-cache", "--var", "name=Ada"]);
    assert.equal(code, 0);
    const content = await readFile(join(outDir, "out/hello.txt"), "utf8");
    assert.equal(content, "Hello from CLI");
  });
});

test("build --dry-run reports what would be written without touching disk", async () => {
  await withTempDir(async (outDir) => {
    const code = await main(["build", fixtureTemplate, "--out-dir", outDir, "--no-cache", "--dry-run"]);
    assert.equal(code, 0);
    await assert.rejects(() => readFile(join(outDir, "out/hello.txt"), "utf8"));
    await assert.rejects(() => readFile(join(outDir, ".fileable-lock.json"), "utf8"));
  });
});

test("clean with no lock file reports nothing to clean, returns 0", async () => {
  await withTempDir(async (outDir) => {
    const code = await main(["clean", outDir]);
    assert.equal(code, 0);
  });
});

test("clean removes exactly what a previous build wrote, plus the lock file", async () => {
  await withTempDir(async (outDir) => {
    await main(["build", fixtureTemplate, "--out-dir", outDir, "--no-cache"]);
    await readFile(join(outDir, "out/hello.txt"), "utf8"); // sanity: it's really there

    const code = await main(["clean", outDir]);
    assert.equal(code, 0);
    await assert.rejects(() => readFile(join(outDir, "out/hello.txt"), "utf8"));
    await assert.rejects(() => readFile(join(outDir, ".fileable-lock.json"), "utf8"));
  });
});

test("clean --dry-run reports removals without actually deleting anything", async () => {
  await withTempDir(async (outDir) => {
    await main(["build", fixtureTemplate, "--out-dir", outDir, "--no-cache"]);

    const code = await main(["clean", outDir, "--dry-run"]);
    assert.equal(code, 0);
    assert.equal(await readFile(join(outDir, "out/hello.txt"), "utf8"), "Hello from CLI");
    await readFile(join(outDir, ".fileable-lock.json"), "utf8"); // still there
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
