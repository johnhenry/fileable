import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { resolve } from "../src/resolve.js";
import { IPFS } from "../src/components.js";
import { FileableError } from "../src/types.js";
import type { Descriptor, IPFSProps } from "../src/types.js";

const CID = "bafybeigdyrztestcidfortestingonly";

/**
 * A real local HTTP server standing in for a public IPFS gateway, following
 * this codebase's own established pattern for testing `src`'s network-fetch
 * path (see resolve.test.ts's "src pointing at a URL fetches it") --
 * deterministic and fast, not dependent on any real gateway's availability.
 */
async function withMockGateway(
  handler: (path: string) => { status: number; body: string | Buffer },
  run: (gatewayUrl: string) => Promise<void>,
): Promise<void> {
  const server: Server = createServer((req, res) => {
    const { status, body } = handler(req.url ?? "/");
    res.writeHead(status);
    res.end(body);
  });
  await new Promise<void>((resolvePromise) => server.listen(0, resolvePromise));
  const port = (server.address() as { port: number }).port;
  try {
    await run(`http://127.0.0.1:${port}/ipfs/`);
  } finally {
    await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
  }
}

test('<File src="ipfs://...">  fetches via the configured gateway', async () => {
  await withMockGateway(
    (path) => (path === `/ipfs/${CID}/hello.txt` ? { status: 200, body: "hello from ipfs" } : { status: 404, body: "" }),
    async (gatewayUrl) => {
      const node: Descriptor = { tag: "file", props: { name: "out.txt", src: `ipfs://${CID}/hello.txt` }, children: [] };
      const [resolved] = await resolve([node], { ipfsGateway: gatewayUrl });
      assert.equal((resolved.props as { __resolvedContent?: string }).__resolvedContent, "hello from ipfs");
    },
  );
});

test('<File src="ipfs://...">  is binary-safe, same as https:// already is', async () => {
  const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2, 3]);
  await withMockGateway(
    (path) => (path === `/ipfs/${CID}/logo.png` ? { status: 200, body: bytes } : { status: 404, body: "" }),
    async (gatewayUrl) => {
      const node: Descriptor = { tag: "file", props: { name: "logo.png", src: `ipfs://${CID}/logo.png` }, children: [] };
      const [resolved] = await resolve([node], { ipfsGateway: gatewayUrl });
      const content = (resolved.props as { __resolvedContent?: string | Buffer }).__resolvedContent;
      assert.ok(Buffer.isBuffer(content));
      assert.ok((content as Buffer).equals(bytes));
    },
  );
});

test('<File src="ipfs://...">  throws a clear FileableError on a gateway error', async () => {
  await withMockGateway(
    () => ({ status: 404, body: "not found" }),
    async (gatewayUrl) => {
      const node: Descriptor = { tag: "file", props: { name: "out.txt", src: `ipfs://${CID}/missing.txt` }, children: [] };
      await assert.rejects(() => resolve([node], { ipfsGateway: gatewayUrl }), FileableError);
    },
  );
});

test("<IPFS> (a genuinely new tag) fetches content and normalizes to a real <File> artifact", async () => {
  await withMockGateway(
    (path) => (path === `/ipfs/${CID}/index.html` ? { status: 200, body: "<h1>from ipfs</h1>" } : { status: 404, body: "" }),
    async (gatewayUrl) => {
      const node = IPFS({ name: "index.html", src: `ipfs://${CID}/index.html` });
      const [resolved] = await resolve([node], { ipfsGateway: gatewayUrl });
      // Normalized: downstream code (layout.ts, hash.ts, every writer) sees
      // an ordinary "file" node, with zero awareness "ipfs" ever existed.
      assert.equal(resolved.tag, "file");
      assert.equal((resolved.props as { __resolvedContent?: string }).__resolvedContent, "<h1>from ipfs</h1>");
    },
  );
});

test("<IPFS> without src throws a clear error", async () => {
  const node = IPFS({ name: "index.html" } as unknown as IPFSProps);
  await assert.rejects(() => resolve([node]), FileableError);
});

test("<IPFS> composes with the rest of the pipeline -- nested inside a Dir, gets a real output path", async () => {
  await withMockGateway(
    (path) => (path === `/ipfs/${CID}/a.txt` ? { status: 200, body: "A" } : { status: 404, body: "" }),
    async (gatewayUrl) => {
      const { layout } = await import("../src/layout.js");
      const dir: Descriptor = {
        tag: "dir",
        props: { name: "site" },
        children: [IPFS({ name: "a.txt", src: `ipfs://${CID}/a.txt` })],
      };
      const [resolved] = await resolve([dir], { ipfsGateway: gatewayUrl });
      const result = layout([resolved]);
      const fileArtifact = result.artifacts.find((a) => a.kind === "file")!;
      assert.equal(fileArtifact.outputPath, "site/a.txt");
      assert.equal(fileArtifact.content, "A");
    },
  );
});
