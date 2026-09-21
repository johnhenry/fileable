#!/usr/bin/env node
/**
 * Runs template.tsx for real, against a real local HTTP server standing in
 * for an IPFS gateway -- not a public one. Verified directly (not assumed):
 * every major public gateway (ipfs.io, dweb.link, w3s.link, nftstorage.link)
 * currently returns 429 on a direct server-side fetch, migrating to
 * browser-only service-worker access (see gatewaychanges.ipfs.io). For real
 * usage outside this example, point `ipfsGateway` at a self-hosted gateway
 * (e.g. a local Kubo node's `http://127.0.0.1:8080/ipfs/`) or an
 * authenticated gateway service instead of the library's own default.
 *
 * Run with: npm run build && node examples/05-ipfs-src/run.mjs
 * (plain .mjs, not compiled by tsc -- run from its own source location,
 * importing the compiled dist/ output directly, same as any other consumer
 * of this package would).
 */
import { createServer } from "node:http";
import { render } from "../../dist/src/index.js";
import template from "../../dist/examples/05-ipfs-src/template.js";

const CID = "bafybeigdyrztestcidfortestingonly";

const server = createServer((req, res) => {
  if (req.url === `/ipfs/${CID}/index.html`) {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<h1>Hello from IPFS</h1>");
    return;
  }
  res.writeHead(404);
  res.end("not found");
});

await new Promise((resolve) => server.listen(0, resolve));
const { port } = server.address();
const ipfsGateway = `http://127.0.0.1:${port}/ipfs/`;

try {
  // No "/dist" appended here -- the template's own root is already
  // <Dir name="dist">, so outDir is just this example's own directory.
  const summary = await render(template, { outDir: import.meta.dirname, ipfsGateway, cache: false });
  console.log("written:", summary.written);
} finally {
  await new Promise((resolve) => server.close(resolve));
}
