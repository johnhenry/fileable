/**
 * Two different-sized answers to "how do I add a new content source",
 * living side by side on purpose:
 *
 *  1. `<File src="ipfs://<cid>/<path>">` -- a new URI scheme recognized by
 *     the EXISTING `src` prop, right alongside the `https://`/local-path/
 *     code-module branches it already has (see resolve.ts's `loadSrc()`).
 *     No new tag, no new component, no new type -- the smallest possible
 *     change.
 *
 *  2. `<IPFS name="..." src="ipfs://<cid>/<path>">` -- a genuinely new,
 *     independently-reserved primitive (its own factory in components.ts,
 *     its own entry in jsx-runtime.ts's RESERVED_TAGS, its own required-prop
 *     validation), which resolve.ts normalizes into an ordinary `<File>`
 *     the instant its content is fetched -- so layout.ts/hash.ts/every
 *     writer needs zero awareness this tag exists. Both share one real
 *     fetch implementation (`fetchIpfs()`) -- the tag-level wiring is what
 *     differs, not the content-fetching logic.
 *
 * `ipfsGateway` (a `render()`/`resolve()` option, default
 * `"https://ipfs.io/ipfs/"`) is what `ipfs://<cid>/<path>` resolves
 * against. Run with: `examples/05-ipfs-src/run.mjs`, not the bare CLI --
 * see that file's own header comment for why (the short version: every
 * major public IPFS gateway currently rejects direct server-side fetches
 * with a 429, migrating to browser-only service-worker access, confirmed
 * by actually trying several of them -- so this example points a real,
 * local HTTP server at `ipfsGateway` instead of a public one, the same way
 * this package's own tests do).
 */
import { Dir, File, IPFS } from "@johnhenry/fileable";

const CID = "bafybeigdyrztestcidfortestingonly";

const template = (
  <Dir name="dist">
    <File name="via-src.html" src={`ipfs://${CID}/index.html`} />
    <IPFS name="via-ipfs-tag.html" src={`ipfs://${CID}/index.html`} />
  </Dir>
);

export default template;
