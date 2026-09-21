import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { render } from "../src/render.js";
import { resolve } from "../src/resolve.js";
import { MarkdownHTML } from "../src/components.js";
import { FileableError } from "../src/types.js";
import type { Descriptor } from "../src/types.js";

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "fileable-markdownhtml-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("<MarkdownHTML src=local.md> converts a real local file through markdownToHtml()", async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, "post.md"), "# Title\n\nSome **bold** text.");
    const node = MarkdownHTML({ name: "post.html", src: "post.md" });
    const [resolved] = await resolve([node], { cwd: dir });
    assert.equal(resolved.tag, "file"); // normalized, same trick <IPFS> uses
    const content = (resolved.props as { __resolvedContent?: string }).__resolvedContent;
    assert.match(content!, /<h1>Title<\/h1>/);
    assert.match(content!, /<strong>bold<\/strong>/);
  });
});

test("<MarkdownHTML src> reuses loadSrc() fully -- https:// works, not just local paths", async () => {
  const server: Server = createServer((_req, res) => {
    res.writeHead(200);
    res.end("## From the network");
  });
  await new Promise<void>((resolvePromise) => server.listen(0, resolvePromise));
  const port = (server.address() as { port: number }).port;
  try {
    const node = MarkdownHTML({ name: "post.html", src: `http://127.0.0.1:${port}/post.md` });
    const [resolved] = await resolve([node]);
    const content = (resolved.props as { __resolvedContent?: string }).__resolvedContent;
    assert.match(content!, /<h2>From the network<\/h2>/);
  } finally {
    await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
  }
});

test("<MarkdownHTML src> reuses loadSrc() fully -- ipfs:// works too", async () => {
  const CID = "bafytestmarkdown";
  const server: Server = createServer((req, res) => {
    if (req.url === `/ipfs/${CID}/post.md`) {
      res.writeHead(200);
      res.end("### From IPFS");
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolvePromise) => server.listen(0, resolvePromise));
  const port = (server.address() as { port: number }).port;
  try {
    const node = MarkdownHTML({ name: "post.html", src: `ipfs://${CID}/post.md` });
    const [resolved] = await resolve([node], { ipfsGateway: `http://127.0.0.1:${port}/ipfs/` });
    const content = (resolved.props as { __resolvedContent?: string }).__resolvedContent;
    assert.match(content!, /<h3>From IPFS<\/h3>/);
  } finally {
    await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
  }
});

test("<MarkdownHTML> without src throws", async () => {
  const node = MarkdownHTML({ name: "post.html" } as unknown as { name: string; src: string });
  await assert.rejects(() => resolve([node]), FileableError);
});

test("<MarkdownHTML src> pointing at binary content throws a clear error instead of mangling it", async () => {
  const logoPath = join(process.cwd(), "test/fixtures/logo.png");
  const node = MarkdownHTML({ name: "logo.html", src: logoPath });
  await assert.rejects(() => resolve([node]), (error: unknown) => {
    assert.ok(error instanceof FileableError);
    assert.match(error.message, /must resolve to text content/);
    return true;
  });
});

test("<MarkdownHTML src> pointing at a code module throws a clear error", async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, "partial.mjs"), "export default 'not markdown';");
    const node = MarkdownHTML({ name: "out.html", src: "partial.mjs" });
    await assert.rejects(() => resolve([node], { cwd: dir }), (error: unknown) => {
      assert.ok(error instanceof FileableError);
      assert.match(error.message, /must resolve to text content/);
      return true;
    });
  });
});

test("nested JSX children are appended AFTER the converted HTML, not run through markdown themselves", async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, "post.md"), "# Title");
    const node: Descriptor = {
      tag: "markdownhtml",
      props: { name: "post.html", src: "post.md" },
      children: ["\n<!-- literal, not markdown -->"],
    };
    const [resolved] = await resolve([node], { cwd: dir });
    assert.equal(resolved.tag, "file");
    // __resolvedContent holds only the converted-from-src part; children are
    // combined in at layout/serialize time, same as any other <File>.
    const content = (resolved.props as { __resolvedContent?: string }).__resolvedContent;
    assert.match(content!, /<h1>Title<\/h1>/);
    assert.deepEqual(resolved.children, ["\n<!-- literal, not markdown -->"]);
  });
});

test("end to end through render(): a real .html file lands on disk with converted markdown", async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, "post.md"), "# Hello\n\nReal build.");
    const outDir = join(dir, "out");
    const tree: Descriptor = {
      tag: "dir",
      props: { name: "site" },
      children: [{ tag: "markdownhtml", props: { name: "post.html", src: join(dir, "post.md") }, children: [] }],
    };
    await render(tree, { outDir, cache: false });
    const written = await readFile(join(outDir, "site/post.html"), "utf8");
    assert.match(written, /<h1>Hello<\/h1>/);
    assert.match(written, /Real build\./);
  });
});
