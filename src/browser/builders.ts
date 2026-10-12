/**
 * JSX-free builders: author a fileable tree with plain function calls, no
 * JSX transform (or bundler config) required. All of these only build
 * descriptors via the same factories JSX resolves to.
 */
import { Dir, File, Rm } from "../components.js";
import { jsx } from "../jsx-runtime.js";
import type { Descriptor, DescriptorChild, DirProps, FileProps, RmProps, Tag } from "../types.js";

type ComponentFn = (props: never) => unknown;

/**
 * Hyperscript-style element builder, `h(type, props, ...children)`.
 * `type` is `Dir`/`File`/`Rm`/..., any function component, `Fragment`, or an
 * ordinary markup tag name like `"p"` (reserved lowercase `"dir"`/`"file"`/...
 * throw, exactly as in JSX). Also usable as a classic-runtime JSX factory
 * (`/** @jsx h *\/`).
 */
export function h(
  type: Tag | ComponentFn,
  props?: Record<string, unknown> | null,
  ...children: DescriptorChild[]
): Descriptor {
  const allProps: Record<string, unknown> = { ...(props ?? {}) };
  if (children.length > 0) allProps.children = children.length === 1 ? children[0] : children;
  return jsx(type as Tag, allProps);
}

type Rest<P> = Omit<P, "name" | "children">;

/** `dir("site", [file("a.txt", "A")])` === `<Dir name="site"><File name="a.txt">A</File></Dir>`. */
export function dir(name: string, children?: DescriptorChild | DescriptorChild[], props?: Rest<DirProps>): Descriptor {
  return Dir({ ...(props ?? {}), name, children } as DirProps);
}

/** `file("a.txt", "A", { mode: "644" })` === `<File name="a.txt" mode="644">A</File>`. */
export function file(name: string, content?: DescriptorChild | DescriptorChild[], props?: Rest<FileProps>): Descriptor {
  return File({ ...(props ?? {}), name, children: content } as FileProps);
}

/** `rm("dist/**", { onMissing: "ignore" })` === `<Rm target="dist/**" onMissing="ignore" />`. */
export function rm(target: string, props?: Omit<RmProps, "target">): Descriptor {
  return Rm({ ...(props ?? {}), target } as RmProps);
}
