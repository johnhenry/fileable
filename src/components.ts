/**
 * Explicit, importable wrappers around the three structural primitives.
 * `<File>`/`<Dir>`/`<Rm>` are just ordinary functions that call `jsx()`
 * with a fixed tag -- "go to definition" on them shows exactly what they
 * do, instead of `<file>`/`<dir>`/`<rm>` being matched as special strings
 * somewhere inside jsx-runtime.ts. Both spellings are fully equivalent and
 * interchangeable: these don't replace the lowercase primitives (the PRD's
 * documented spelling), they're just a less "magical" way to reach the
 * same three tags, and (since they're plain functions) callable directly
 * without JSX syntax too, e.g. `File({ name: "a.txt" })`.
 */
import { jsx } from "./jsx-runtime.js";
import type { Descriptor, DirProps, FileProps, RmProps } from "./types.js";

export function File(props: FileProps): Descriptor {
  return jsx("file", props);
}

export function Dir(props: DirProps): Descriptor {
  return jsx("dir", props);
}

export function Rm(props: RmProps): Descriptor {
  return jsx("rm", props);
}
