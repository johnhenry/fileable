/**
 * #41: npm runs the CLI through a symlink (`node_modules/.bin/fileable`, a
 * global install), so `process.argv[1]` is the link, not the real file. The
 * CLI used to compare it with `import.meta.url` and silently do nothing.
 * Directory links are junctions on Windows (no privilege needed).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const isWindows = process.platform === "win32";
const repoRoot = process.cwd();
const realBin = join(repoRoot, "dist/bin");

async function version(): Promise<string> {
  return (JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8")) as { version: string }).version;
}

function run(script: string, args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

test("the CLI runs when started through a linked directory (#41)", async () => {
  const root = await mkdtemp(join(tmpdir(), "fileable-bin-link-"));
  try {
    const linked = join(root, "bin");
    await symlink(realBin, linked, isWindows ? "junction" : "dir");
    const result = run(join(linked, "fileable.js"), ["--version"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), await version());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the CLI runs when started through a file symlink, as node_modules/.bin does (#41)", async () => {
  const root = await mkdtemp(join(tmpdir(), "fileable-bin-link-"));
  try {
    const linked = join(root, "fileable");
    let target = join(realBin, "fileable.js");
    try {
      await symlink(target, linked, "file");
      target = linked;
    } catch (error) {
      // Windows without the symlink privilege: npm uses a .cmd shim there,
      // which starts node with the real path; check that path instead.
      if (!(isWindows && (error as NodeJS.ErrnoException).code === "EPERM")) throw error;
    }
    const result = run(target, ["--version"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), await version());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
