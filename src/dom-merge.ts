/**
 * `join="dom-merge"` (PRD SS2.2): instead of a raw string concat, each
 * fragment is parsed and folded into one shared `<head>`/`<body>`, so
 * combining a full-document header partial with a full-document footer
 * partial (or several HTML snippets) produces one well-formed document
 * instead of duplicated/interleaved `<html>`/`<body>` tags.
 */
import { parse } from "node-html-parser";

export function mergeHtmlFragments(pieces: string[]): string {
  const headChildren: string[] = [];
  const bodyChildren: string[] = [];
  let sawDocumentShell = false;

  for (const piece of pieces) {
    const root = parse(piece, { comment: true });
    const head = root.querySelector("head");
    const body = root.querySelector("body");
    if (head || body) {
      sawDocumentShell = true;
      if (head) headChildren.push(head.innerHTML);
      if (body) bodyChildren.push(body.innerHTML);
      // Anything outside head/body but still top-level (rare) rides along with body.
      for (const child of root.childNodes) {
        const tag = (child as { tagName?: string }).tagName?.toLowerCase();
        if (tag === "html" || tag === "head" || tag === "body") continue;
        bodyChildren.push(child.toString());
      }
    } else {
      bodyChildren.push(piece);
    }
  }

  if (!sawDocumentShell) {
    return bodyChildren.join("");
  }
  const head = headChildren.length ? `<head>${headChildren.join("")}</head>` : "";
  return `<html>${head}<body>${bodyChildren.join("")}</body></html>`;
}
