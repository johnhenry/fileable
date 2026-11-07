// Write-stage benchmark (issue #22). Not part of `npm test`.
//
//   npm run bench                 # all sizes, both targets
//   node bench/write.mjs 2000     # only the listed sizes
//
// Renders a fixed blog-like template (HTML pages under posts/<year>/<month>/,
// plus an index) with the public render() from dist/, at each size, for the
// loose and wbn targets. "cold" is a fresh outDir; "warm" is a second render
// into the same outDir, so every artifact is lock-unchanged and the write
// stage only has to confirm the outputs still exist. Reports the median of
// several runs, in milliseconds.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { render, h, dir, file } from "../dist/src/index.js";

const SIZES = process.argv.slice(2).map(Number).filter(Boolean);
const sizes = SIZES.length > 0 ? SIZES : [200, 2000, 10000];
const runsFor = (n) => (n >= 10000 ? 3 : 5);

function page(i) {
  return h(
    "html",
    null,
    h("head", null, h("title", null, `Post ${i}`)),
    h(
      "body",
      null,
      h("h1", null, `Post number ${i}`),
      h("p", null, `This is the first paragraph of post ${i}. `, h("em", null, "Some emphasis"), ", and a ", h("a", { href: "/" }, "link home"), "."),
      h("ul", null, h("li", null, "one"), h("li", null, "two"), h("li", null, "three")),
      h("pre", null, h("code", null, `const n = ${i};\nconsole.log(n * 2);`)),
      h("p", null, "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(4)),
    ),
  );
}

// posts/<year>/<month>/post-<i>.html: 10 years x 12 months = up to 120 leaf dirs.
function template(n, encode) {
  const byDir = new Map();
  for (let i = 0; i < n; i++) {
    const year = String(2016 + (i % 10));
    const month = String(1 + (Math.floor(i / 10) % 12)).padStart(2, "0");
    const key = `${year}/${month}`;
    if (!byDir.has(key)) byDir.set(key, []);
    byDir.get(key).push(file(`post-${i}.html`, page(i)));
  }
  const years = new Map();
  for (const [key, files] of byDir) {
    const [year, month] = key.split("/");
    if (!years.has(year)) years.set(year, []);
    years.get(year).push(dir(month, files));
  }
  const index = file(
    "index.html",
    h("html", null, h("body", null, h("h1", null, "Index"), h("p", null, `${n} posts`))),
  );
  const posts = dir("posts", [...years].map(([year, months]) => dir(year, months)));
  return encode === "wbn" ? dir("site.wbn", [index, posts], { encode: "wbn" }) : dir("site", [index, posts]);
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

async function measure(n, encode) {
  const tree = template(n, encode);
  const cold = [];
  const warm = [];
  for (let r = 0; r < runsFor(n); r++) {
    const outDir = await mkdtemp(join(tmpdir(), "fileable-bench-"));
    try {
      let t = performance.now();
      await render(tree, { outDir });
      cold.push(performance.now() - t);
      t = performance.now();
      const second = await render(tree, { outDir });
      warm.push(performance.now() - t);
      if (second.written.length !== 0) throw new Error(`warm run rewrote ${second.written.length} artifacts`);
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  }
  return { cold: median(cold), warm: median(warm) };
}

console.log(`node ${process.version}, ${process.platform}/${process.arch}`);
console.log("| files | target | cold (ms) | warm (ms) |");
console.log("|---:|---|---:|---:|");
for (const n of sizes) {
  for (const encode of ["loose", "wbn"]) {
    const { cold, warm } = await measure(n, encode);
    console.log(`| ${n.toLocaleString("en-US")} | ${encode} | ${cold.toFixed(0)} | ${warm.toFixed(0)} |`);
  }
}
