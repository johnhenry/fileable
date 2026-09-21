/**
 * Fileable's own JSX runtime (PRD SS7.2) -- selected via a per-file
 * `@jsxImportSource @johnhenry/fileable` pragma or `compilerOptions.jsxImportSource`.
 * No React/Solid/Astro runtime involved: structural tags become descriptor
 * nodes; everything else (plain markup tags, function components) is
 * evaluated immediately, mirroring the JSX call tree 1:1. Normalization
 * (flattening fragments/arrays, dropping nullish children, assigning
 * stable ids) happens in the Build stage (`build.ts`), not here.
 *
 * `dir`/`file`/`rm`/`ipfs`/`markdownhtml` are reserved and NOT treated as
 * structural when written as bare lowercase tags -- authoring `<dir>`/
 * `<file>`/`<rm>`/`<ipfs>`/`<markdownhtml>` directly throws. `Dir`/`File`/
 * `Rm`/`IPFS`/`MarkdownHTML`, imported from "@johnhenry/fileable" (see
 * `components.ts`), are the only supported way to reach the primitives, so
 * every template has an explicit, importable, "go to definition"-able
 * symbol for them rather than a bare string matched somewhere inside this
 * dispatch. (`ipfs`/`markdownhtml` are the EXAMPLE primitives -- see their
 * own doc comments in types.ts -- reserved the exact same way as the three
 * real ones.)
 */
import type { Descriptor, DescriptorChild, Tag } from "./types.js";
import { FILEABLE_DESCRIPTOR, FRAGMENT, FileableError } from "./types.js";

export const Fragment = FRAGMENT;

type ComponentFn = (props: Record<string, unknown>) => unknown;

const RESERVED_TAGS: Record<string, string> = {
  dir: "Dir",
  file: "File",
  rm: "Rm",
  ipfs: "IPFS",
  markdownhtml: "MarkdownHTML",
};

function toChildArray(children: unknown): DescriptorChild[] {
  if (children === undefined) return [];
  return ([] as DescriptorChild[]).concat(children as DescriptorChild);
}

/**
 * Declared to return `Descriptor` for authoring ergonomics (so `<File>...`
 * expressions can flow into `Descriptor`-typed variables, arrays, and the
 * `linkTo()`/`symlink` params without a cast) even though a function
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
  if (typeof type === "string" && type in RESERVED_TAGS) {
    const component = RESERVED_TAGS[type];
    throw new FileableError(
      `<${type}> is reserved and not a fileable primitive on its own -- ` +
        `import { ${component} } from "@johnhenry/fileable" and write <${component}> instead of the bare lowercase tag`,
      `<${type}>`,
    );
  }
  const { children, ...rest } = allProps;
  const descriptor: Descriptor = {
    tag: type,
    props: rest,
    children: toChildArray(children),
    [FILEABLE_DESCRIPTOR]: true,
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
    // `dir`/`file`/`rm` are deliberately NOT declared here (they fall
    // through to the index signature below, loosely typed) -- import
    // Dir/File/Rm from "@johnhenry/fileable" for both proper prop types and to
    // actually reach the structural primitives; the bare tags throw
    // at runtime (see RESERVED_TAGS above).
    [elemName: string]: CommonProps;
  }
  export type Element = Descriptor;
  export interface ElementChildrenAttribute {
    children: unknown;
  }
}
