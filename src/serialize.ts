/**
 * Turns a (post-substitution) descriptor subtree into a content string.
 * Used by Layout to materialize every real `<file>` artifact's content, and
 * recursively for every `<file>`/`<dir>` nested inside it (nameless inlining,
 * PRD SS5.1) -- generic markup tags (<h1>, <ul>, <a>, ...) are stringified as
 * HTML here too, since they're just content, not fileable primitives.
 *
 * By the time this runs, every LinkRef has already been substituted with its
 * final string (Layout does that before calling this), so this module only
 * needs to know which descriptors are anchor targets that actually need an
 * injected `<span id="...">` marker.
 */
import { isDescriptor } from "./types.js";
import type { Descriptor, DescriptorChild } from "./types.js";
import { mergeHtmlFragments } from "./dom-merge.js";

const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

export interface SerializeCtx {
  anchorIds: Map<Descriptor, string>;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function serializeAttrs(props: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (value === true) {
      parts.push(key);
      continue;
    }
    parts.push(`${key}="${escapeAttr(String(value))}"`);
  }
  return parts.length ? ` ${parts.join(" ")}` : "";
}

function renderMarkupTag(node: Descriptor, ctx: SerializeCtx): string {
  const inner = serializeChildren(node.children, "concat", ctx);
  const attrs = serializeAttrs(node.props);
  if (VOID_TAGS.has(node.tag as string)) {
    return `<${String(node.tag)}${attrs} />`;
  }
  return `<${String(node.tag)}${attrs}>${inner}</${String(node.tag)}>`;
}

function serializeStructural(node: Descriptor, ctx: SerializeCtx): string {
  const innerJoin = (node.props.join as "concat" | "dom-merge") ?? "concat";
  const base = (node.props as { __resolvedContent?: string }).__resolvedContent ?? "";
  const inner = serializeChildren(node.children, innerJoin, ctx);
  const combined = base + inner;
  const anchorId = ctx.anchorIds.get(node);
  return anchorId ? `<span id="${escapeAttr(anchorId)}"></span>${combined}` : combined;
}

function serializeChild(child: DescriptorChild, ctx: SerializeCtx): string {
  if (child === null || child === undefined || typeof child === "boolean") return "";
  if (typeof child === "string") return child;
  if (typeof child === "number") return String(child);
  if (Array.isArray(child)) return child.map((c) => serializeChild(c, ctx)).join("");
  if (isDescriptor(child)) {
    if (child.tag === "file" || child.tag === "dir") {
      return serializeStructural(child, ctx);
    }
    return renderMarkupTag(child, ctx);
  }
  // A LinkRef reaching here means Layout's substitution pass missed it.
  throw new Error(`Unresolved reference reached serialization: ${JSON.stringify(child)}`);
}

export function serializeChildren(
  children: DescriptorChild[],
  join: "concat" | "dom-merge",
  ctx: SerializeCtx,
): string {
  const pieces = children.map((child) => serializeChild(child, ctx));
  return join === "dom-merge" ? mergeHtmlFragments(pieces) : pieces.join("");
}
