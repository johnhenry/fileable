import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { render } from "../src/render.js";
import { useCollection } from "../src/api.js";
import type { Descriptor, DescriptorChild, LinkRef } from "../src/types.js";

/**
 * Adapts the PRD SS9 "Blog with Index" worked example. Two deliberate
 * deviations from the PRD's literal text, both noted in the PR description:
 *  - `symlink` targets the actual generated `<file>` descriptor for the
 *    latest post (matching the documented `FileNode | string` type),
 *    rather than a plain frontmatter data object.
 *  - `<rm target>` is written relative to the current `dist/` context
 *    (matching v1's CLEAR semantics, which this implementation follows),
 *    rather than repeating a leading "dist/" while already inside `<dir
 *    name="dist">`.
 */

interface Post {
  title: string;
  slug: string;
  date: string;
  body: string;
}

function parseFrontmatter(path: string): Post {
  const raw = readFileSync(path, "utf8");
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw)!;
  const meta: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const [key, ...rest] = line.split(":");
    meta[key.trim()] = rest.join(":").trim();
  }
  return { title: meta.title, slug: meta.slug, date: meta.date, body: match[2].trim() };
}

function link(target: Descriptor | string): LinkRef {
  return { __fileableRef: "link", target };
}

test("SS9 worked example: blog with index, latest symlink, and draft cleanup", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "fileable-worked-example-"));
  try {
    // Simulate a stale draft left over from a previous build.
    await mkdir(join(outDir, "dist"), { recursive: true });
    await writeFile(join(outDir, "dist/old.draft.html"), "stale");

    const postsPattern = join(process.cwd(), "test/fixtures/posts/*.md");
    const posts = useCollection(postsPattern)
      .map(parseFrontmatter)
      .sort((a, b) => (a.date < b.date ? 1 : -1)); // newest first

    const postFiles: Descriptor[] = posts.map((post) => ({
      tag: "file",
      props: { name: `${post.slug}.html`, doctype: "html" },
      children: [`<h1>${post.title}</h1>`, post.body],
    }));

    const indexChildren: DescriptorChild[] = ["<ul>"];
    posts.forEach((post, i) => {
      indexChildren.push('<li><a href="', link(postFiles[i]), `">${post.title}</a></li>`);
    });
    indexChildren.push("</ul>");

    const indexFile: Descriptor = {
      tag: "file",
      props: { name: "index.html", doctype: "html" },
      children: indexChildren,
    };

    const latestFile: Descriptor = {
      tag: "file",
      props: { name: "latest", symlink: postFiles[0] },
      children: [],
    };

    const tree: Descriptor = {
      tag: "dir",
      props: { name: "dist" },
      children: [
        { tag: "dir", props: { name: "posts" }, children: postFiles },
        indexFile,
        latestFile,
        { tag: "rm", props: { target: "*.draft.html" }, children: [] },
      ],
    };

    const result = await render(tree, { outDir, cache: false });

    const helloWorld = await readFile(join(outDir, "dist/posts/hello-world.html"), "utf8");
    assert.match(helloWorld, /<h1>Hello World<\/h1>/);
    assert.match(helloWorld, /Hello world body\./);

    const index = await readFile(join(outDir, "dist/index.html"), "utf8");
    assert.match(index, /href="posts\/second-post\.html">Second Post<\/a>/);
    assert.match(index, /href="posts\/hello-world\.html">Hello World<\/a>/);
    // Newest (second-post, 2024-06-01) listed before hello-world (2024-01-01).
    assert.ok(index.indexOf("Second Post") < index.indexOf("Hello World"));

    const latestInfo = await lstat(join(outDir, "dist/latest"));
    if (latestInfo.isSymbolicLink()) {
      const latestContent = await readFile(join(outDir, "dist/latest"), "utf8");
      assert.match(latestContent, /Second Post/);
    } else {
      const latestContent = await readFile(join(outDir, "dist/latest"), "utf8");
      assert.match(latestContent, /Second Post/);
    }

    assert.ok(result.removed.includes("dist/old.draft.html"));
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});
