import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reflect } from "../src/eject.js";
import { FileableError } from "../src/types.js";

const pngPath = join(process.cwd(), "test/fixtures/logo.png");

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "fileable-eject-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("reflect() inlines text and references binary content by default (infer)", async () => {
  await withTempDir(async (root) => {
    const src = join(root, "src");
    await mkdir(join(src, "img"), { recursive: true });
    await writeFile(join(src, "hello.txt"), "Hello, world!\n");
    const png = await readFile(pngPath);
    await writeFile(join(src, "img", "logo.png"), png);

    const source = await reflect(src);
    assert.match(source, /import \{ Dir, File \} from "@johnhenry\/fileable";/);
    assert.match(source, /<Dir name="src">/);
    assert.match(source, /<File name="hello\.txt">\{`Hello, world!\n`\}<\/File>/);
    assert.match(source, /<Dir name="img">/);
    assert.match(source, /<File name="logo\.png" src="\.\/src\/img\/logo\.png" \/>/);
  });
});

test("reflect() sorts entries alphabetically for deterministic output", async () => {
  await withTempDir(async (root) => {
    const src = join(root, "src");
    await mkdir(src, { recursive: true });
    await writeFile(join(src, "b.txt"), "b");
    await writeFile(join(src, "a.txt"), "a");

    const source = await reflect(src);
    assert.ok(source.indexOf("a.txt") < source.indexOf("b.txt"));
  });
});

test("reflect() skips .fileable-lock.json", async () => {
  await withTempDir(async (root) => {
    const src = join(root, "src");
    await mkdir(src, { recursive: true });
    await writeFile(join(src, "hello.txt"), "hi");
    await writeFile(join(src, ".fileable-lock.json"), "{}");

    const source = await reflect(src);
    assert.doesNotMatch(source, /fileable-lock/);
  });
});

test("reflect() on a single file (not a directory) emits a lone <File>", async () => {
  await withTempDir(async (root) => {
    const file = join(root, "notes.txt");
    await writeFile(file, "just notes\n");

    const source = await reflect(file);
    assert.match(source, /<File name="notes\.txt">\{`just notes\n`\}<\/File>/);
    assert.doesNotMatch(source, /<Dir/);
  });
});

test("reflect() represents a symlink via a `symlink` prop carrying the literal link text", async () => {
  await withTempDir(async (root) => {
    const src = join(root, "src");
    await mkdir(src, { recursive: true });
    await writeFile(join(src, "real.txt"), "real");
    await symlink("real.txt", join(src, "alias.txt"));

    const source = await reflect(src);
    assert.match(source, /<File name="alias\.txt" symlink="real\.txt" \/>/);
  });
});

test('contentMode "inline" forced on binary content throws', async () => {
  await withTempDir(async (root) => {
    const src = join(root, "src");
    await mkdir(src, { recursive: true });
    await writeFile(join(src, "logo.png"), await readFile(pngPath));

    await assert.rejects(() => reflect(src, { contentMode: "inline" }), FileableError);
  });
});

test('contentMode "inline" forced on binary content with binaryMode: "base64" succeeds instead of throwing', async () => {
  await withTempDir(async (root) => {
    const src = join(root, "src");
    await mkdir(src, { recursive: true });
    const png = await readFile(pngPath);
    await writeFile(join(src, "logo.png"), png);

    const source = await reflect(src, { contentMode: "inline", binaryMode: "base64" });
    assert.match(source, /<File name="logo\.png" base64="[A-Za-z0-9+/=]+" \/>/);
    assert.doesNotMatch(source, /src=/);
  });
});

test('binaryMode: "base64" alone (default contentMode "infer") also inlines binary as base64 instead of "ref"', async () => {
  await withTempDir(async (root) => {
    const src = join(root, "src");
    await mkdir(src, { recursive: true });
    await writeFile(join(src, "hello.txt"), "hi"); // text still inlines as text, unaffected
    const png = await readFile(pngPath);
    await writeFile(join(src, "logo.png"), png);

    const source = await reflect(src, { binaryMode: "base64" });
    assert.match(source, /<File name="hello\.txt">\{`hi`\}<\/File>/);
    assert.match(source, /<File name="logo\.png" base64="[A-Za-z0-9+/=]+" \/>/);
  });
});

test('binaryMode: "base64" ejection round-trips byte-exact through a real build()', async () => {
  await withTempDir(async (root) => {
    const src = join(root, "src");
    await mkdir(src, { recursive: true });
    const png = await readFile(pngPath);
    await writeFile(join(src, "logo.png"), png);

    const source = await reflect(src, { binaryMode: "base64" });
    const match = source.match(/base64="([A-Za-z0-9+/=]+)"/);
    assert.ok(match, "generated source should contain a base64 attribute");

    const { build } = await import("../src/build.js");
    const { resolve } = await import("../src/resolve.js");
    const { layout } = await import("../src/layout.js");
    const { File } = await import("../src/components.js");
    const rebuilt = build(File({ name: "logo.png", base64: match![1] }));
    const resolved = await resolve(rebuilt, {});
    const laidOut = layout(resolved, {});
    assert.equal(laidOut.artifacts.length, 1);
    const content = laidOut.artifacts[0].content;
    assert.ok(Buffer.isBuffer(content));
    assert.ok((content as Buffer).equals(png));
  });
});

test("an invalid binaryMode throws before touching disk", async () => {
  await withTempDir(async (root) => {
    const src = join(root, "src");
    await mkdir(src, { recursive: true });
    await writeFile(join(src, "hello.txt"), "hi");

    // @ts-expect-error -- deliberately invalid, proving the runtime check catches it
    await assert.rejects(() => reflect(src, { binaryMode: "bogus" }), FileableError);
  });
});

test('contentMode "ref" forces every file to be referenced, even text', async () => {
  await withTempDir(async (root) => {
    const src = join(root, "src");
    await mkdir(src, { recursive: true });
    await writeFile(join(src, "hello.txt"), "hi");

    const source = await reflect(src, { contentMode: "ref" });
    assert.match(source, /<File name="hello\.txt" src="\.\/src\/hello\.txt" \/>/);
  });
});

test("content overrides win over the global contentMode", async () => {
  await withTempDir(async (root) => {
    const src = join(root, "src");
    await mkdir(src, { recursive: true });
    await writeFile(join(src, "hello.txt"), "hi");

    const source = await reflect(src, {
      contentMode: "ref",
      content: [{ pattern: "hello.txt", mode: "inline" }],
    });
    assert.match(source, /<File name="hello\.txt">\{`hi`\}<\/File>/);
  });
});

test("an invalid contentMode throws before touching disk", async () => {
  await withTempDir(async (root) => {
    await assert.rejects(
      // @ts-expect-error deliberately invalid for the test
      () => reflect(root, { contentMode: "bogus" }),
      FileableError,
    );
  });
});

test("an invalid content override mode throws before touching disk", async () => {
  await withTempDir(async (root) => {
    await assert.rejects(
      // @ts-expect-error deliberately invalid for the test
      () => reflect(root, { content: [{ pattern: "*", mode: "bogus" }] }),
      FileableError,
    );
  });
});

test('contentMode "ask" never asks about binary content -- it is always "ref"', async () => {
  await withTempDir(async (root) => {
    const src = join(root, "src");
    await mkdir(src, { recursive: true });
    await writeFile(join(src, "logo.png"), await readFile(pngPath));

    const source = await reflect(src, {
      contentMode: "ask",
      onAsk: async () => {
        throw new Error("onAsk should not be called for binary content");
      },
    });
    assert.match(source, /<File name="logo\.png" src="\.\/src\/logo\.png" \/>/);
  });
});

test('contentMode "ask" defers to onAsk for text content', async () => {
  await withTempDir(async (root) => {
    const src = join(root, "src");
    await mkdir(src, { recursive: true });
    await writeFile(join(src, "hello.txt"), "hi");

    const source = await reflect(src, {
      contentMode: "ask",
      onAsk: async (file) => {
        assert.equal(file.relativePath, "hello.txt");
        assert.equal(file.isText, true);
        return "ref";
      },
    });
    assert.match(source, /<File name="hello\.txt" src="\.\/src\/hello\.txt" \/>/);
  });
});

test('contentMode "ask" without an onAsk callback throws for text content', async () => {
  await withTempDir(async (root) => {
    const src = join(root, "src");
    await mkdir(src, { recursive: true });
    await writeFile(join(src, "hello.txt"), "hi");

    await assert.rejects(() => reflect(src, { contentMode: "ask" }), FileableError);
  });
});

test("copyAssets copies referenced files into assets/ next to outFile and points src there", async () => {
  await withTempDir(async (root) => {
    const src = join(root, "src");
    await mkdir(src, { recursive: true });
    const png = await readFile(pngPath);
    await writeFile(join(src, "logo.png"), png);
    const outFile = join(root, "template.tsx");

    const source = await reflect(src, { outFile, copyAssets: true });
    assert.match(source, /<File name="logo\.png" src="\.\/assets\/logo\.png" \/>/);
    const copied = await readFile(join(root, "assets", "logo.png"));
    assert.ok(copied.equals(png));
  });
});

test("outFile controls how relative src paths are computed", async () => {
  await withTempDir(async (root) => {
    const src = join(root, "src");
    await mkdir(src, { recursive: true });
    await writeFile(join(src, "logo.png"), await readFile(pngPath));

    const nestedOutFile = join(root, "nested", "template.tsx");
    const source = await reflect(src, { outFile: nestedOutFile });
    assert.match(source, /<File name="logo\.png" src="\.\.\/src\/logo\.png" \/>/);
  });
});
