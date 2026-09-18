/**
 * Run with: npm run build && node dist/bin/fileable.js build dist/examples/01-hello-world/template.js
 */
import { Dir, File } from "fileable";

const template = (
  <Dir name="dist">
    <File name="hello.txt">Hello, world!</File>
  </Dir>
);

export default template;
