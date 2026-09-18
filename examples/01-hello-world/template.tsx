/**
 * Run with: npm run build && node dist/examples/01-hello-world/template.js
 */
import { render } from "fileable";

const template = (
  <dir name="dist">
    <file name="hello.txt">Hello, world!</file>
  </dir>
);

await render(template, { outDir: new URL(".", import.meta.url).pathname, cache: false });
