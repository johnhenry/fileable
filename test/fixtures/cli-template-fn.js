// A template whose default export is a function, exercising `fileable
// build --var ...` -- the CLI calls this with the parsed --var object.
export default function (vars) {
  const name = vars.name ?? "World";
  const count = vars.count ?? 0;
  const draft = vars.draft ?? false;
  return {
    tag: "dir",
    props: { name: "out" },
    children: [
      {
        tag: "file",
        props: { name: "greeting.txt" },
        children: [`Hello, ${name}! count=${count} draft=${draft}`],
      },
    ],
  };
}
