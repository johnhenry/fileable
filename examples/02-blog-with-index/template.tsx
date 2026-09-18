/**
 * Adapts PRD SS9 ("Blog with Index"). Run with (from the repo root -- see
 * the contentDir note below):
 *   npm run build && node dist/bin/fileable.js build dist/examples/02-blog-with-index/template.js
 *
 * Post bodies are markdown, rendered to HTML via the `markdown()` runtime
 * helper (a thin wrapper around `marked` -- convenience only, not a new
 * mechanism; you're equally free to call any other transform function
 * inline instead).
 *
 * Two deliberate deviations from the PRD's literal text (both noted in the
 * PR description):
 *  - `symlink` targets the actual generated `<file>` descriptor for the
 *    latest post, matching the documented `FileNode | string` type, rather
 *    than a plain frontmatter data object.
 *  - `<rm target>` is written relative to the current `dist/` context
 *    (matching v1's CLEAR semantics), rather than repeating a leading
 *    "dist/" while already inside `<dir name="dist">`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { link, markdown, useCollection } from "fileable";
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
  <file name={`${post.slug}.html`} doctype="html">
    <file src="partials/header.js" />
    <h1>{post.title}</h1>
    {markdown(post.body)}
    <file src="partials/footer.js" />
  </file>
));

const template = (
  <dir name="dist">
    <dir name="posts">{postFiles}</dir>

    <file name="index.html" doctype="html">
      <file src="partials/header.js" />
      <ul>
        {posts.map((post, i) => (
          <li>
            <a href={link(postFiles[i])}>{post.title}</a>
          </li>
        ))}
      </ul>
      <file src="partials/footer.js" />
    </file>

    <file name="latest" symlink={postFiles[0]} />

    <rm target="*.draft.html" />
  </dir>
);

export default template;
