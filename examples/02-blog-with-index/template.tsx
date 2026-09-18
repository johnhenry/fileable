/**
 * Adapts PRD SS9 ("Blog with Index"). Run with (from the repo root -- see
 * the contentDir note below):
 *   npm run build && node dist/bin/fileable.js build dist/examples/02-blog-with-index/template.js
 *
 * Post bodies are markdown, rendered to HTML via the `markdownToHtml()` runtime
 * helper (a thin wrapper around `marked` -- convenience only, not a new
 * mechanism; you're equally free to call any other transform function
 * inline instead).
 *
 * Two deliberate deviations from the PRD's literal text (both noted in the
 * PR description):
 *  - `symlink` targets the actual generated `<File>` descriptor for the
 *    latest post, matching the documented `FileNode | string` type, rather
 *    than a plain frontmatter data object.
 *  - `<Rm target>` is written relative to the current `dist/` context
 *    (matching v1's CLEAR semantics), rather than repeating a leading
 *    "dist/" while already inside `<Dir name="dist">`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Dir, File, Rm, linkTo, markdownToHtml, useCollection } from "fileable";
import type { Descriptor } from "fileable";

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

// content/*.md are plain data, not TypeScript -- tsc doesn't copy them into
// dist, so they're only ever found at their original source location. This
// resolves relative to wherever `fileable build` is invoked from (the repo
// root in the usage note above), independent of --out-dir/--cwd, which only
// affect the render() side (partials/, which *are* compiled, and output).
const contentDir = join(process.cwd(), "examples/02-blog-with-index/content");

const posts = useCollection(join(contentDir, "posts/*.md"))
  .map(parseFrontmatter)
  .sort((a, b) => (a.date < b.date ? 1 : -1)); // newest first

const postFiles: Descriptor[] = posts.map((post) => (
  <File name={`${post.slug}.html`} doctype="html">
    <File src="partials/header.js" />
    <h1>{post.title}</h1>
    {markdownToHtml(post.body)}
    <File src="partials/footer.js" />
  </File>
));

const template = (
  <Dir name="dist">
    <Dir name="posts">{postFiles}</Dir>

    <File name="index.html" doctype="html">
      <File src="partials/header.js" />
      <ul>
        {posts.map((post, i) => (
          <li>
            <a href={linkTo(postFiles[i])}>{post.title}</a>
          </li>
        ))}
      </ul>
      <File src="partials/footer.js" />
    </File>

    <File name="latest" symlink={postFiles[0]} />

    <Rm target="*.draft.html" />
  </Dir>
);

export default template;
