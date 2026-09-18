// A pre-compiled partial containing both a link target and a link() call to
// it, used to prove that two separate `<file src="this-path">` occurrences
// each get their own independent copy (see cloneDescriptorTree in types.ts)
// rather than sharing the one object Node's import() cache hands back.
const target = { tag: "file", props: {}, children: ["TARGET"] };
export default {
  tag: "file",
  props: {},
  children: [target, "ref:", { __fileableRef: "link", target }],
};
