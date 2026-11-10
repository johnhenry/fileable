/**
 * #34: `fileable clean` treats the ids in `.fileable-lock.json` as untrusted.
 * Each test cleans `<root>/out` next to `<root>/outside`, which holds a
 * sentinel file, and checks `<root>/outside` is untouched. An unsafe id
 * fails the whole clean with E_UNSAFE_PATH before anything is removed.
 * Directory links are junctions on Windows (no privilege needed); a file
 * link falls back to a hard link where Windows refuses a symlink.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { link, lstat, mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../bin/fileable.js";
import { HASH_ALGORITHM } from "../src/hash.js";

const isWindows = process.platform === "win32";

interface Fixture {
  root: string;
  out: string;
  outside: string;
}

async function withFixture(fn: (f: Fixture) => Promise<void>): Promise<void> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "fileable-clean-")));
  const out = join(root, "out");
  const outside = join(root, "outside");
  await mkdir(out);
  await mkdir(outside);
  await writeFile(join(outside, "sentinel.txt"), "original");
  try {
    await fn({ root, out, outside });
    const left = (await readdir(outside, { recursive: true })).map((p) => p.replaceAll("\\", "/")).sort();
    assert.deepEqual(left, ["sentinel.txt"], "clean may not remove anything outside its directory");
    assert.equal(await readFile(join(outside, "sentinel.txt"), "utf8"), "original");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function writeLock(out: string, ids: string[]): Promise<void> {
  const artifacts: Record<string, { hash: string; dependsOn: string[] }> = {};
  for (const id of ids) artifacts[id] = { hash: "0", dependsOn: [] };
  await writeFile(join(out, ".fileable-lock.json"), JSON.stringify({ version: 1, algorithm: HASH_ALGORITHM, artifacts }));
}

interface CleanRun {
  code: number;
  events: Array<Record<string, unknown>>;
}

async function clean(out: string, extra: string[] = []): Promise<CleanRun> {
  let stdout = "";
  const code = await main(["clean", out, "--json", ...extra], { io: { stdout: (t) => (stdout += t), stderr: () => {} } });
  const events = stdout.split("\n").filter((l) => l !== "").map((l) => JSON.parse(l) as Record<string, unknown>);
  return { code, events };
}

function assertUnsafe(run: CleanRun): void {
  assert.equal(run.code, 1);
  const error = run.events.find((e) => e.event === "error");
  assert.equal(error?.code, "E_UNSAFE_PATH", JSON.stringify(error));
  assert.equal(run.events.filter((e) => e.event === "file").length, 0, "nothing may be reported removed");
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function dirLink(target: string, path: string): Promise<void> {
  await symlink(target, path, isWindows ? "junction" : "dir");
}

async function fileLink(target: string, path: string): Promise<void> {
  try {
    await symlink(target, path, "file");
  } catch (error) {
    if (!(isWindows && (error as NodeJS.ErrnoException).code === "EPERM")) throw error;
    await link(target, path);
  }
}

// Lock ids that are not a safe relative path. `abs` is filled in per fixture.
const UNSAFE_IDS: Array<[string, (f: Fixture) => string]> = [
  ["parent traversal", () => "../outside"],
  ["traversal to a file", () => "../outside/sentinel.txt"],
  ["traversal after normalizing", () => "a/../../outside"],
  ["absolute path to outside", (f) => f.outside],
  ["absolute POSIX path", () => "/etc/passwd-not-really"],
  ["UNC path", () => "//server/share/x"],
  ["drive letter", () => "C:/Windows/x"],
  ["drive-relative", () => "c:x"],
  ["backslash traversal", () => "..\\outside"],
  ["empty id", () => ""],
  ["dot (outDir itself)", () => "."],
  ["dots-and-spaces segment", () => ".. /outside"],
  ["control character", () => "a\u0000b"],
];

for (const [label, id] of UNSAFE_IDS) {
  test(`clean refuses an unsafe lock id and removes nothing: ${label}`, async () => {
    await withFixture(async (f) => {
      await writeFile(join(f.out, "keep.txt"), "x");
      await writeLock(f.out, ["keep.txt", id(f)]);
      assertUnsafe(await clean(f.out));
      assert.ok(await exists(join(f.out, "keep.txt")), "a safe id listed with an unsafe one must not be removed");
      assert.ok(await exists(join(f.out, ".fileable-lock.json")), "the lock file stays");
    });
  });
}

test("clean --dry-run refuses an unsafe lock id too", async () => {
  await withFixture(async (f) => {
    await writeLock(f.out, ["../outside"]);
    assertUnsafe(await clean(f.out, ["--dry-run"]));
  });
});

test("clean refuses an id that goes through a directory link leading outside", async () => {
  await withFixture(async (f) => {
    await dirLink(f.outside, join(f.out, "link"));
    await writeFile(join(f.out, "keep.txt"), "x");
    await writeLock(f.out, ["keep.txt", "link/sentinel.txt"]);
    assertUnsafe(await clean(f.out));
    assert.ok(await exists(join(f.out, "keep.txt")));
  });
});

test("clean refuses an id under a nested directory link leading outside", async () => {
  await withFixture(async (f) => {
    await mkdir(join(f.out, "a"));
    await dirLink(f.outside, join(f.out, "a", "link"));
    await writeLock(f.out, ["a/link/sentinel.txt"]);
    assertUnsafe(await clean(f.out));
  });
});

test("clean removes a directory link listed in the lock as a link, not its target", async () => {
  await withFixture(async (f) => {
    await dirLink(f.outside, join(f.out, "link"));
    await writeLock(f.out, ["link"]);
    const run = await clean(f.out);
    assert.equal(run.code, 0, JSON.stringify(run.events));
    assert.equal(await exists(join(f.out, "link")), false, "the link itself is removed");
  });
});

test("clean removes a file link listed in the lock as a link, not its target", async () => {
  await withFixture(async (f) => {
    await fileLink(join(f.outside, "sentinel.txt"), join(f.out, "flink"));
    await writeLock(f.out, ["flink"]);
    const run = await clean(f.out);
    assert.equal(run.code, 0, JSON.stringify(run.events));
    assert.equal(await exists(join(f.out, "flink")), false);
  });
});

test("clean removes a real directory without following a link inside it", async () => {
  await withFixture(async (f) => {
    await mkdir(join(f.out, "d"));
    await writeFile(join(f.out, "d", "x.txt"), "x");
    await dirLink(f.outside, join(f.out, "d", "link"));
    await writeLock(f.out, ["d"]);
    const run = await clean(f.out);
    assert.equal(run.code, 0, JSON.stringify(run.events));
    assert.equal(await exists(join(f.out, "d")), false);
  });
});

test("clean accepts a link inside outDir that stays inside it, and normalizes ids", async () => {
  await withFixture(async (f) => {
    await mkdir(join(f.out, "real"));
    await writeFile(join(f.out, "real", "a.txt"), "a");
    await writeFile(join(f.out, "b.txt"), "b");
    await dirLink(join(f.out, "real"), join(f.out, "alias"));
    await writeLock(f.out, ["alias/a.txt", "x/../b.txt", "missing/never-there.txt"]);
    const run = await clean(f.out);
    assert.equal(run.code, 0, JSON.stringify(run.events));
    assert.equal(await exists(join(f.out, "real", "a.txt")), false);
    assert.equal(await exists(join(f.out, "b.txt")), false);
    assert.deepEqual(
      run.events.filter((e) => e.event === "file").map((e) => e.path).sort(),
      [".fileable-lock.json", "alias/a.txt", "b.txt", "missing/never-there.txt"],
    );
  });
});
