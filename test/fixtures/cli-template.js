// A plain-object tree, standing in for a compiled template's default
// export -- used to test bin/fileable.js without depending on a real JSX
// template file.
export default {
  tag: "dir",
  props: { name: "out" },
  children: [{ tag: "file", props: { name: "hello.txt" }, children: ["Hello from CLI"] }],
};
