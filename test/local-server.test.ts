/**
 * Regression guard for #24: a test server must listen on the same loopback
 * address its requests go to. `listen(0)` without a host binds `::`, the
 * request goes to 127.0.0.1:<port>, and another process holding that port on
 * 127.0.0.1 answers instead (an intermittent 404).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { listenLoopback, LOOPBACK } from "./local-server.js";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

test("listenLoopback() binds 127.0.0.1, not the :: wildcard", async () => {
  const server = createServer((_req, res) => res.end("ok"));
  const port = await listenLoopback(server);
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    assert.equal(address.address, LOOPBACK);
    assert.equal(address.port, port);
    const res = await fetch(`http://${LOOPBACK}:${port}/`);
    assert.equal(await res.text(), "ok");
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("no test or example calls server.listen() without a host", () => {
  const sources: string[] = [];
  for (const f of readdirSync(join(repoRoot, "test"))) {
    if (/\.tsx?$/.test(f) && f !== "local-server.ts" && f !== "local-server.test.ts") sources.push(join(repoRoot, "test", f));
  }
  sources.push(join(repoRoot, "examples/05-ipfs-src/run.mjs"));
  const offenders: string[] = [];
  for (const file of sources) {
    const text = readFileSync(file, "utf8");
    // listen(<port>, <callback>) or listen(<port>) -- a port with no host string.
    for (const m of text.matchAll(/\.listen\(\s*[^,)]+\s*(?:,(?!\s*["'`])[^)]*)?\)/g)) {
      offenders.push(`${file}: ${m[0]}`);
    }
  }
  assert.deepEqual(offenders, []);
});
