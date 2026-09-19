/**
 * The only supported way to reach the three structural primitives.
 * `<File>`/`<Dir>`/`<Rm>` (or `File(props)`/`Dir(props)`/`Rm(props)` called
 * directly, no JSX needed) are ordinary functions with an explicit,
 * importable, "go to definition"-able identity -- unlike the lowercase
 * `<file>`/`<dir>`/`<rm>` tags, which are reserved and throw if authored
 * directly (see jsx-runtime.ts's RESERVED_TAGS). These build the descriptor
 * directly rather than going through `jsx()`, since `jsx()` is exactly
 * where that lowercase-tag rejection lives -- these three are the sanctioned
 * bypass, not a loophole.
 */
import type { Descriptor, DescriptorChild, DirProps, FileProps, RmProps } from "./types.js";

function toChildArray(children: unknown): DescriptorChild[] {
  if (children === undefined) return [];
  return ([] as DescriptorChild[]).concat(children as DescriptorChild);
}

function structural(tag: "dir" | "file" | "rm", props: Record<string, unknown>): Descriptor {
  const { children, ...rest } = props;
  return { tag, props: rest, children: toChildArray(children) };
}

export function File(props: FileProps): Descriptor {
  return structural("file", props);
}

export function Dir(props: DirProps): Descriptor {
  return structural("dir", props);
}

export function Rm(props: RmProps): Descriptor {
  return structural("rm", props);
}
