/**
 * The CLI's machine interface (#25): --json NDJSON events, stable error and
 * exit codes, the project manifest, .ts/.tsx loading, `fileable watch`, and
 * running under Node's permission model. Most of these run the real
 * compiled CLI in a child process, because "nothing but events on stdout"
 * is only meaningful for a real process's stdout.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../bin/fileable.js";
import { describeError, ERROR_CODES } from "../src/errors.js";
import { render } from "../src/render.js";
import { FileableError } from "../src/types.js";
import type { Descriptor } from "../src/types.js";

const repoRoot = process.cwd();
const cli = join(repoRoot, "dist/bin/fileable.js");
const fixtures = join(repoRoot, "test/fixtures");

type Event = { v: number; event: string; time: string; [key: string]: unknown };

interface Run {
  code: number;
  stdout: string;
  stderr: string;
  events: Event[];
}

function runCli(args: string[], options: { nodeArgs?: string[]; cwd?: string } = {}): Promise<Run> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [...(options.nodeArgs ?? []), cli, ...args], {
      cwd: options.cwd ?? repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => {
      const events = args.includes("--json")
        ? stdout
            .split("\n")
            .filter((l) => l !== "")
            .map((l) => JSON.parse(l) as Event)
        : [];
      resolvePromise({ code: code ?? -1, stdout, stderr, events });
    });
  });
}

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  // realpath: macOS's tmpdir is behind a symlink, and the permission model
  // and fs.watch both see the real path.
  const dir = await realpath(await mkdtemp(join(tmpdir(), "fileable-machine-")));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const names = (events: Event[]) => events.map((e) => e.event);
const only = (events: Event[], name: string) => events.filter((e) => e.event === name);

test("--json: every stdout line is an event in the shared envelope, ending in done then stopped", async () => {
  await withTempDir(async (dir) => {
    await writeFile(
      join(dir, "template.js"),
      `console.log("noise from the template");
       process.stdout.write("more noise\\n");
       export default { tag: "dir", props: { name: "site" }, children: [
         { tag: "file", props: { name: "a.txt" }, children: ["A"] },
         { tag: "file", props: { name: "b.txt" }, children: [(console.info("render-time noise"), "B")] },
       ] };`,
    );
    const first = await runCli(["build", join(dir, "template.js"), "--json"]);
    assert.equal(first.code, 0, first.stderr);
    for (const e of first.events) {
      assert.equal(e.v, 1);
      assert.equal(typeof e.event, "string");
      assert.ok(!Number.isNaN(Date.parse(e.time)), "time is ISO-8601");
      assert.ok(!("type" in e) && !("schemaVersion" in e));
    }
    assert.deepEqual(names(first.events), ["start", "file", "file", "file", "done", "stopped"]);
    assert.match(first.stderr, /noise from the template/);
    assert.match(first.stderr, /more noise/);
    assert.match(first.stderr, /render-time noise/);
    assert.doesNotMatch(first.stdout, /noise/);

    const start = first.events[0];
    assert.equal(start.command, "build");
    assert.equal(start.outDir, dir);
    const files = only(first.events, "file");
    assert.deepEqual(
      files.map((f) => [f.path, f.action, f.kind, f.encode, f.root]),
      [
        ["site", "written", "dir", "loose", true],
        ["site/a.txt", "written", "file", "loose", false],
        ["site/b.txt", "written", "file", "loose", false],
      ],
    );
    for (const f of files) assert.match(String(f.hash), /^sha256:[0-9a-f]{64}$/);
    const done = only(first.events, "done")[0];
    assert.equal(done.ok, true);
    assert.equal(done.exitCode, 0);
    assert.deepEqual(done.counts, { written: 3, unchanged: 0, skipped: 0, removed: 0, warnings: 0 });
    assert.deepEqual((done.output as { shape: string }).shape, "loose");
    assert.deepEqual(first.events.at(-1), { ...first.events.at(-1), event: "stopped", exitCode: 0 });

    const second = await runCli(["build", join(dir, "template.js"), "--json"]);
    const done2 = only(second.events, "done")[0];
    assert.deepEqual(done2.counts, { written: 0, unchanged: 3, skipped: 0, removed: 0, warnings: 0 });
    assert.equal(done2.buildHash, done.buildHash, "same output, same buildHash, even with nothing rewritten");
    assert.ok(only(second.events, "file").every((f) => f.action === "unchanged"));
  });
});

test("without --json the output is the human text it always was", async () => {
  await withTempDir(async (dir) => {
    const run = await runCli(["build", join(fixtures, "cli-template.js"), "--out-dir", dir, "--no-cache"]);
    assert.equal(run.code, 0);
    assert.equal(run.stdout, "  write out\n  write out/hello.txt\nfileable: 2 written, 0 skipped, 0 removed\n");
  });
});

test("error codes and exit codes: E_MODULE_NOT_FOUND / E_NOT_A_TEMPLATE / E_MODULE_LOAD exit 3, E_USAGE 2, build errors 1", async () => {
  await withTempDir(async (dir) => {
    const missing = await runCli(["build", join(dir, "nope.js"), "--json"]);
    assert.equal(missing.code, 3);
    assert.deepEqual(names(missing.events), ["start", "error", "done", "stopped"]);
    const error = only(missing.events, "error")[0];
    assert.equal(error.code, "E_MODULE_NOT_FOUND");
    assert.equal(error.fatal, true);
    assert.equal(error.exitCode, 3);
    assert.equal(only(missing.events, "done")[0].ok, false);

    const text = await runCli(["build", join(dir, "nope.js")]);
    assert.equal(text.code, 3);
    assert.match(text.stderr, /fileable: error E_MODULE_NOT_FOUND: template ".*nope\.js" not found/);
    assert.equal(text.stdout, "");

    const noDefault = await runCli(["build", join(fixtures, "no-default-export.js"), "--out-dir", dir, "--json"]);
    assert.equal(noDefault.code, 3);
    assert.equal(only(noDefault.events, "error")[0].code, "E_NOT_A_TEMPLATE");

    await writeFile(join(dir, "broken.js"), "export default {");
    const broken = await runCli(["build", join(dir, "broken.js"), "--json"]);
    assert.equal(broken.code, 3);
    assert.equal(only(broken.events, "error")[0].code, "E_MODULE_LOAD");

    await writeFile(join(dir, "throws.js"), "export default () => { throw new Error('nope'); };");
    const threw = await runCli(["build", join(dir, "throws.js"), "--json"]);
    assert.equal(threw.code, 3);
    assert.equal(only(threw.events, "error")[0].code, "E_MODULE_LOAD");

    const usage = await runCli(["build", "--bogus", "--json"]);
    assert.equal(usage.code, 2);
    assert.deepEqual(names(usage.events), ["error", "stopped"]);
    assert.equal(only(usage.events, "error")[0].code, "E_USAGE");

    await writeFile(join(dir, "cmd.js"), `export default { tag: "file", props: { name: "x.txt", cmd: "echo hi" }, children: [] };`);
    const exec = await runCli(["build", join(dir, "cmd.js"), "--json"]);
    assert.equal(exec.code, 1);
    assert.equal(only(exec.events, "error")[0].code, "E_EXEC_DENIED");
  });
});

test("describeError(): codes pass through, Node's ERR_ACCESS_DENIED becomes E_ACCESS_DENIED naming the flag, the rest E_INTERNAL", () => {
  const coded = describeError(new FileableError("dup", "a > b", undefined, "E_PATH_CONFLICT"));
  assert.equal(coded.code, "E_PATH_CONFLICT");
  assert.equal(coded.exitCode, 1);
  assert.equal(coded.path, "a > b");

  const nodeDenied = Object.assign(new Error("Access to this API has been restricted."), {
    code: "ERR_ACCESS_DENIED",
    permission: "FileSystemWrite",
    resource: "/out/x.txt",
  });
  const wrapped = describeError(new FileableError("write failed", "x.txt", nodeDenied, "E_SRC"));
  assert.equal(wrapped.code, "E_ACCESS_DENIED");
  assert.equal(wrapped.exitCode, 5);
  assert.equal(wrapped.permission, "FileSystemWrite");
  assert.equal(wrapped.resource, "/out/x.txt");
  assert.match(wrapped.message, /--allow-fs-write=\/out\/x\.txt/);

  const plain = describeError(new TypeError("boom"));
  assert.equal(plain.code, "E_INTERNAL");
  assert.equal(plain.exitCode, 1);

  // The exit codes shared with servable/hostable: 1, 2, 3, 5 (4 is servable's E_LISTEN).
  assert.deepEqual([...new Set(Object.values(ERROR_CODES).map((c) => c.exitCode))].sort(), [1, 2, 3, 5]);
});

test("clean --json reports removed files; eject --json puts the source in done", async () => {
  await withTempDir(async (dir) => {
    assert.equal((await runCli(["build", join(fixtures, "cli-template.js"), "--out-dir", dir])).code, 0);
    const clean = await runCli(["clean", dir, "--json"]);
    assert.equal(clean.code, 0);
    assert.deepEqual(
      only(clean.events, "file").map((f) => [f.path, f.action]).sort(),
      [[".fileable-lock.json", "removed"], ["out", "removed"], ["out/hello.txt", "removed"]],
    );
    assert.deepEqual((only(clean.events, "done")[0].counts as { removed: number }).removed, 3);
    assert.equal(existsSync(join(dir, "out")), false);

    await mkdir(join(dir, "tree"));
    await writeFile(join(dir, "tree/hi.txt"), "hi");
    const eject = await runCli(["eject", join(dir, "tree"), "--json"]);
    assert.equal(eject.code, 0);
    assert.deepEqual(names(eject.events), ["start", "done", "stopped"]);
    assert.match(String(only(eject.events, "done")[0].source), /<File name="hi\.txt">/);

    const ask = await runCli(["eject", join(dir, "tree"), "--json", "--content-mode", "ask"]);
    assert.equal(ask.code, 2);
    assert.equal(only(ask.events, "error")[0].code, "E_USAGE");
  });
});

test("project manifest: fileable.config.json or package.json \"fileable\" supplies template, outDir, vars and encode", async () => {
  await withTempDir(async (dir) => {
    await writeFile(
      join(dir, "template.js"),
      `export default (vars) => ({ tag: "dir", props: { name: "site" }, children: [{ tag: "file", props: { name: "hi.txt" }, children: ["Hi " + vars.who] }] });`,
    );
    await writeFile(join(dir, "fileable.config.json"), JSON.stringify({ template: "template.js", outDir: "out", vars: { who: "manifest" } }));
    const run = await runCli(["build", "--project", dir, "--json", "--var", "who=flag"]);
    assert.equal(run.code, 0, run.stderr);
    assert.equal(await readFile(join(dir, "out/site/hi.txt"), "utf8"), "Hi flag", "--var overrides manifest vars");
    assert.equal(only(run.events, "start")[0].manifest, join(dir, "fileable.config.json"));

    // Running in the project directory with no arguments at all.
    const bare = await runCli(["build", "--json", "--no-cache"], { cwd: dir });
    assert.equal(bare.code, 0, bare.stderr);
    assert.equal(await readFile(join(dir, "out/site/hi.txt"), "utf8"), "Hi manifest");

    const shown = await runCli(["manifest", dir, "--json"]);
    assert.equal(shown.code, 0);
    const manifestEvent = only(shown.events, "manifest")[0];
    assert.equal(manifestEvent.source, "fileable.config.json");
    assert.deepEqual(manifestEvent.manifest, { template: "template.js", outDir: "out", vars: { who: "manifest" } });

    // package.json field, with encode.
    await rm(join(dir, "fileable.config.json"));
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "p", fileable: { template: "template.js", outDir: "zipped", encode: "zip", vars: { who: "pkg" } } }));
    const zipped = await runCli(["build", "--project", dir, "--json"]);
    assert.equal(zipped.code, 0, zipped.stderr);
    assert.ok(existsSync(join(dir, "zipped/site.zip")));
    assert.equal((only(zipped.events, "done")[0].output as { shape: string }).shape, "zip");

    // Both -> ambiguous.
    await writeFile(join(dir, "fileable.config.json"), JSON.stringify({ template: "template.js" }));
    const both = await runCli(["build", "--project", dir, "--json"]);
    assert.equal(both.code, 2);
    assert.equal(only(both.events, "error")[0].code, "E_MANIFEST");

    // allowExec is never a manifest key.
    await rm(join(dir, "package.json"));
    await writeFile(join(dir, "fileable.config.json"), JSON.stringify({ template: "template.js", allowExec: true }));
    const exec = await runCli(["build", "--project", dir, "--json"]);
    assert.equal(exec.code, 2);
    assert.match(String(only(exec.events, "error")[0].message), /exec is never enabled by a manifest/);

    const conflicting = await runCli(["build", "template.js", "--project", dir, "--json"]);
    assert.equal(conflicting.code, 2);
    assert.equal(only(conflicting.events, "error")[0].code, "E_USAGE");
  });
});

test("render({ encode }) sets the default encode of root <Dir>s, and refuses a root <File>", async () => {
  await withTempDir(async (dir) => {
    const tree: Descriptor[] = [
      { tag: "dir", props: { name: "a" }, children: [{ tag: "file", props: { name: "x.txt" }, children: ["x"] }] },
      { tag: "dir", props: { name: "b", encode: "loose" }, children: [{ tag: "file", props: { name: "y.txt" }, children: ["y"] }] },
    ];
    const summary = await render(tree, { outDir: dir, encode: "wbn", cache: false });
    assert.deepEqual(summary.outputs.filter((o) => o.root).map((o) => [o.path, o.encode]).sort(), [["a.wbn", "wbn"], ["b", "loose"]]);
    await assert.rejects(
      () => render({ tag: "file", props: { name: "z.txt" }, children: ["z"] }, { outDir: dir, encode: "zip" }),
      (e: unknown) => e instanceof FileableError && e.code === "E_INVALID_OPTION",
    );
  });
});

test(".ts templates load with Node's own type stripping; .tsx uses the project's JSX compiler, or fails with E_JSX_COMPILER", async () => {
  await withTempDir(async (dir) => {
    const ts = await runCli(["build", join(fixtures, "tsx/plain.ts"), "--out-dir", dir, "--json"]);
    assert.equal(ts.code, 0, ts.stderr);
    assert.equal(await readFile(join(dir, "site/hello.txt"), "utf8"), "typed, not compiled");

    // Inside this repo, esbuild (a devDependency) is the project's compiler.
    const tsx = await runCli(["build", join(fixtures, "tsx/template.tsx"), "--out-dir", dir, "--var", "who=Ada"]);
    assert.equal(tsx.code, 0, tsx.stderr);
    assert.equal(
      await readFile(join(dir, "site/index.html"), "utf8"),
      "<h1>TSX without a build step</h1><p>Hello, Ada</p><footer>made with fileable</footer>",
    );

    // Outside any project with a compiler installed.
    const lone = join(dir, "lone");
    await mkdir(lone);
    await copyFile(join(fixtures, "tsx/template.tsx"), join(lone, "template.tsx"));
    await copyFile(join(fixtures, "tsx/partial.tsx"), join(lone, "partial.tsx"));
    const none = await runCli(["build", join(lone, "template.tsx"), "--json"]);
    assert.equal(none.code, 3);
    const error = only(none.events, "error")[0];
    assert.equal(error.code, "E_JSX_COMPILER");
    assert.match(String(error.message), /npm i -D esbuild/);
  });
});

test("under node --permission: works with read on project + fileable and write on out; missing grants are E_ACCESS_DENIED (exit 5) naming the flag", async () => {
  await withTempDir(async (dir) => {
    const project = join(dir, "proj");
    const out = join(dir, "out");
    await mkdir(project);
    await mkdir(out);
    await writeFile(
      join(project, "template.ts"),
      `import { dir, file } from "@johnhenry/fileable";
       export default (vars: { cmd?: boolean } = {}) =>
         dir("site", [file("a.txt", "A"), ...(vars.cmd ? [file("b.txt", "", { cmd: "echo from-cmd" })] : [])]);`,
    );
    await writeFile(join(project, "fileable.config.json"), JSON.stringify({ template: "template.ts", outDir: "../out" }));
    const read = (p: string) => `--allow-fs-read=${p}`;
    const base = ["--permission", read(project), read(repoRoot)];
    const full = [...base, read(out), `--allow-fs-write=${out}`];

    const ok = await runCli(["build", "--project", project, "--json"], { nodeArgs: full });
    assert.equal(ok.code, 0, ok.stderr);
    assert.equal(await readFile(join(out, "site/a.txt"), "utf8"), "A");
    const again = await runCli(["build", "--project", project, "--json"], { nodeArgs: full });
    assert.equal((only(again.events, "done")[0].counts as { unchanged: number }).unchanged, 2, "lock-file cache works");

    const noWrite = await runCli(["build", "--project", project, "--json"], { nodeArgs: [...base, read(out)] });
    assert.equal(noWrite.code, 5);
    const writeError = only(noWrite.events, "error")[0];
    assert.equal(writeError.code, "E_ACCESS_DENIED");
    assert.equal(writeError.permission, "FileSystemWrite");
    assert.match(String(writeError.message), /--allow-fs-write=/);

    const noLockRead = await runCli(["build", "--project", project, "--json"], { nodeArgs: [...base, `--allow-fs-write=${out}`] });
    assert.equal(noLockRead.code, 0, noLockRead.stderr);
    assert.equal(only(noLockRead.events, "warning")[0].code, "E_CACHE_UNREADABLE");

    const noChild = await runCli(["build", "--project", project, "--json", "--allow-exec", "--var", "cmd:boolean=true"], { nodeArgs: full });
    assert.equal(noChild.code, 5);
    const childError = only(noChild.events, "error")[0];
    assert.equal(childError.permission, "ChildProcess");
    assert.match(String(childError.message), /--allow-child-process/);

    const child = await runCli(["build", "--project", project, "--json", "--allow-exec", "--var", "cmd:boolean=true"], {
      nodeArgs: [...full, "--allow-child-process"],
    });
    assert.equal(child.code, 0, child.stderr);
    assert.equal((await readFile(join(out, "site/b.txt"), "utf8")).trim(), "from-cmd");
  });
});

test("fileable watch: rebuilds on change, reports a broken template without stopping, and stops cleanly", async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, "partial.js"), `export const text = "v1";`);
    await writeFile(
      join(dir, "template.js"),
      `import { text } from "./partial.js";
       export default { tag: "dir", props: { name: "site" }, children: [{ tag: "file", props: { name: "a.txt" }, children: [text] }] };`,
    );
    const lines: string[] = [];
    const io = { stdout: (t: string) => lines.push(...t.split("\n").filter(Boolean)), stderr: () => {} };
    const events = () => lines.map((l) => JSON.parse(l) as Event);
    const waitFor = async (predicate: (e: Event[]) => boolean, what: string) => {
      const deadline = Date.now() + 15000;
      while (!predicate(events())) {
        if (Date.now() > deadline) assert.fail(`timed out waiting for ${what}: ${JSON.stringify(names(events()))}`);
        await new Promise((r) => setTimeout(r, 25));
      }
    };
    const doneCount = () => only(events(), "done").length;
    const controller = new AbortController();
    const running = main(["watch", join(dir, "template.js"), "--json", "--debounce", "50"], { io, signal: controller.signal });
    try {

    await waitFor((e) => e.some((x) => x.event === "watching"), "watching");
    assert.equal(await readFile(join(dir, "site/a.txt"), "utf8"), "v1");
    // Give the watcher a moment to settle so the initial build's own writes are behind us.
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(doneCount(), 1, `the first build's own output doesn't trigger a rebuild: ${JSON.stringify(only(events(), "reloading"))}`);

    await writeFile(join(dir, "partial.js"), `export const text = "v2";`);
    await waitFor(() => doneCount() >= 2, "rebuild after change");
    const reloading = only(events(), "reloading")[0];
    assert.ok((reloading.files as string[]).includes("partial.js"), JSON.stringify(only(events(), "reloading")));
    assert.equal(await readFile(join(dir, "site/a.txt"), "utf8"), "v2", "the partial was re-imported fresh");

    await writeFile(join(dir, "partial.js"), `export const text = ;`);
    await waitFor(() => only(events(), "error").length >= 1, "error for broken partial");
    const error = only(events(), "error")[0];
    assert.equal(error.code, "E_MODULE_LOAD");
    assert.equal(error.fatal, false);
    await waitFor(() => only(events(), "done").some((d) => d.ok === false), "failed done");

    await writeFile(join(dir, "partial.js"), `export const text = "v3";`);
    await waitFor(() => only(events(), "done").filter((d) => d.ok === true).length >= 3, "recovery");
    assert.equal(await readFile(join(dir, "site/a.txt"), "utf8"), "v3");

    } finally {
      controller.abort();
    }
    assert.equal(await running, 0);
    const tail = names(events()).slice(-2);
    assert.deepEqual(tail, ["stopping", "stopped"]);
    assert.equal(only(events(), "stopping")[0].signal, "abort");
    // Each reloading is followed by exactly one build: one start and one done.
    const seq = names(events()).filter((n) => n === "reloading" || n === "start" || n === "done");
    for (let i = 0; i < seq.length; i++) {
      if (seq[i] === "reloading") assert.deepEqual(seq.slice(i + 1, i + 3), ["start", "done"]);
    }
  });
});
