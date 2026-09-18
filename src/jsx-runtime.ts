/**
 * Fileable's own JSX runtime (PRD SS7.2) -- selected via a per-file
 * `@jsxImportSource fileable` pragma or `compilerOptions.jsxImportSource`.
 * No React/Solid/Astro runtime involved: structural tags (dir/file/rm)
 * become descriptor nodes; everything else (plain markup tags, function
 * components) is evaluated immediately, mirroring the JSX call tree 1:1.
 * Normalization (flattening fragments/arrays, dropping nullish children,
 * assigning stable ids) happens in the Build stage (`build.ts`), not here.
 */
import type { Descriptor, DescriptorChild, Tag } from "./types.js";
import { FRAGMENT } from "./types.js";

export const Fragment = FRAGMENT;

type ComponentFn = (props: Record<string, unknown>) => unknown;

function toChildArray(children: unknown): DescriptorChild[] {
  if (children === undefined) return [];
  return ([] as DescriptorChild[]).concat(children as DescriptorChild);
}

/**
 * Declared to return `Descriptor` for authoring ergonomics (so `<file>...`
 * expressions can flow into `Descriptor`-typed variables, arrays, and the
 * `link()`/`symlink` params without a cast) even though a function
 * component may, at runtime, return something else (a fragment's array, a
 * string, etc.) -- callers passing a component's result onward should feed
 * it back through JSX/`build()` rather than relying on its own shape.
 */
export function jsx(
  type: Tag | ComponentFn,
  props: (Record<string, unknown> & { children?: unknown }) | null,
): Descriptor {
  const allProps = props ?? {};
  if (typeof type === "function") {
    return type(allProps) as Descriptor;
  }
  const { children, ...rest } = allProps;
  const descriptor: Descriptor = {
    tag: type,
    props: rest,
    children: toChildArray(children),
  };
  return descriptor;
}

// The "automatic" JSX transform calls jsxs() instead of jsx() when there is
// more than one statically-known child; behavior is otherwise identical.
export const jsxs = jsx;

export namespace JSX {
  interface CommonProps {
    [key: string]: unknown;
    children?: unknown;
  }
  export interface IntrinsicElements {
    dir: CommonProps & {
      name?: string;
      from?: string | Promise<string[]> | string[];
      as?: "loose" | "archive";
      mode?: string;
    };
    file: CommonProps & {
      name?: string;
      src?: string | Promise<string>;
      doctype?: string;
      mode?: string;
      symlink?: Descriptor | string;
      cmd?: string;
      join?: "concat" | "dom-merge";
    };
    rm: CommonProps & {
      target: string;
    };
    [elemName: string]: CommonProps;
  }
  export type Element = Descriptor;
  export interface ElementChildrenAttribute {
    children: unknown;
  }
}
