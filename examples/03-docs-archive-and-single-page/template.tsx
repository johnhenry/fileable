/**
 * Demonstrates PRD SS5.2: "loose files on disk, one concatenated file, a
 * zip, and a Web Bundle are different materializations of the same authored
 * tree, not different authoring modes." The same three `src` imports feed
 * an `encode="zip"` `.zip` and an `encode="wbn"` `.wbn` of individually-addressable
 * pages, plus a single `join="dom-merge"` page that folds all three pages'
 * <head>s (each bringing its own <title>/<style>) into one shared <head>
 * instead of duplicating <html>/<head> tags.
 *
 * Run with: npm run build && node dist/bin/fileable.js build dist/examples/03-docs-archive-and-single-page/template.js
 */
import { Dir, File } from "@johnhenry/fileable";

const docs = [
  { slug: "getting-started", src: "docs-src/getting-started.js" },
  { slug: "configuration", src: "docs-src/configuration.js" },
  { slug: "faq", src: "docs-src/faq.js" },
];

const template = (
  <Dir name="dist">
    {/* Materialization 1: a .zip of individually-addressable pages. */}
    <Dir name="docs-zip" encode="zip">
      {docs.map((doc) => (
        <File name={`${doc.slug}.html`} src={doc.src} />
      ))}
    </Dir>

    {/* Materialization 2: the SAME three `src`s as a Web Bundle, directly
        servable via wbn's own Bundle class / createRouter() in the
        @johnhenry/packfile ecosystem, no @johnhenry/packfile dependency
        needed to produce it. */}
    <Dir name="docs-wbn" encode="wbn">
      {docs.map((doc) => (
        <File name={`${doc.slug}.html`} src={doc.src} />
      ))}
    </Dir>

    {/* Materialization 3: the SAME three `src`s, flattened into one page
        via nameless inlining (<File> containing further <File>s) with
        join="dom-merge" combining their <head>s instead of raw concat. */}
    <File name="docs-single-page.html" join="dom-merge">
      {docs.map((doc) => (
        <File src={doc.src} />
      ))}
    </File>
  </Dir>
);

export default template;
