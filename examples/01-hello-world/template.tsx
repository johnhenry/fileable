/**
 * Run with:
 *   npm run build && node dist/bin/fileable.js build dist/examples/01-hello-world/template.js
 *
 * Or pass a name in via the CLI's --var flag (a template's default export
 * can be a function of the parsed --var values instead of a plain tree):
 *   node dist/bin/fileable.js build dist/examples/01-hello-world/template.js --var name=Ada
 */
import { Dir, File } from "fileable";

interface Vars {
  name?: string;
}

export default function template(vars: Vars = {}) {
  const name = vars.name ?? "world";
  return (
    <Dir name="dist">
      <File name="hello.txt">Hello, {name}!</File>
    </Dir>
  );
}
