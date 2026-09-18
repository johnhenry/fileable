/**
 * Stage 1: Build (PRD SS4.1).
 *
 * The jsx-runtime already evaluated the JSX tree synchronously into raw
 * descriptor objects; this stage normalizes the result into a canonical
 * shape so every later stage can rely on it:
 *  - fragments are flattened into their parent's children
 *  - nested arrays (from `.map()`) are flattened
 *  - null/undefined/boolean children are dropped (the usual `{cond && <x/>}` idiom)
 *  - number children become strings
 *  - every Descriptor gets a stable `__id` (used later for fragment anchor ids)
 *
 * Promise-valued props (`src`, `cmd`, ...) are left untouched -- Resolve (Stage 2)
 * is responsible for those.
 */
import { FRAGMENT, isDescriptor, isLinkRef } from "./types.js";
import type { Descriptor, DescriptorChild } from "./types.js";

export function build(root: unknown): Descriptor[] {
  let counter = 0;
  const nextId = () => `n${counter++}`;

  function normalizeOne(node: Descriptor): Descriptor[] {
    node.children = normalizeChildren(node.children);
    if (node.__id === undefined) node.__id = nextId();
    if (node.tag === FRAGMENT) {
      return node.children.filter(isDescriptor);
    }
    return [node];
  }

  function normalizeChildren(children: unknown): DescriptorChild[] {
    const flat: DescriptorChild[] = [];
    const items = Array.isArray(children) ? children : [children];
    for (const item of items) {
      if (item === null || item === undefined || typeof item === "boolean") {
        continue;
      }
      if (Array.isArray(item)) {
        flat.push(...normalizeChildren(item));
        continue;
      }
      if (typeof item === "number") {
        flat.push(String(item));
        continue;
      }
      if (isDescriptor(item)) {
        flat.push(...normalizeOne(item));
        continue;
      }
      if (isLinkRef(item) || typeof item === "string") {
        flat.push(item);
        continue;
      }
      // Anything else (e.g. an object an author mistakenly rendered directly)
      // is coerced to a string rather than silently dropped.
      flat.push(String(item));
    }
    return flat;
  }

  return normalizeChildren(root).filter(isDescriptor);
}
