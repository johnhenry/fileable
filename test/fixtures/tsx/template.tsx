// Loaded by `fileable build` with no compile step (bin/loader.ts, #25):
// esbuild from this repo's devDependencies does the JSX transform.
import { Dir, File } from "@johnhenry/fileable";
import { footer } from "./partial.tsx";

const title: string = "TSX without a build step";

export default function template(vars: { who?: string } = {}) {
  return (
    <Dir name="site">
      <File name="index.html">
        <h1>{title}</h1>
        <p>Hello, {vars.who ?? "world"}</p>
        {footer()}
      </File>
    </Dir>
  );
}
