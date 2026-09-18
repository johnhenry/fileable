/**
 * Content-transformation convenience helper (PRD SS1.3 non-goals rule out a
 * plugin/middleware system -- this is plain sugar around `marked`, not a
 * new mechanism; authors are equally free to call any other markdown
 * library themselves inline, e.g. `{myMarkdownFn(text)}`, with zero
 * fileable involvement).
 */
import { marked } from "marked";

/**
 * Renders markdown to an HTML string, synchronously. `marked.parse()` can
 * technically return a Promise if async extensions are registered on the
 * shared `marked` instance -- this helper assumes the common case (no such
 * extensions) so it can be used directly in JSX content positions the same
 * way `glob()`/`useCollection()` are; register extensions and call `marked`
 * directly if you need async rendering.
 */
export function markdownToHtml(text: string): string {
  return marked.parse(text) as string;
}
