// A .ts template using the JSX-free builders: Node 26's own type stripping
// loads it, no JSX compiler involved (#25).
import { dir, file } from "@johnhenry/fileable";

const greeting: string = "typed, not compiled";
export default dir("site", [file("hello.txt", greeting)]);
