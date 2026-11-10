/**
 * Shared helper for tests that start a throwaway HTTP server (#24).
 *
 * `server.listen(0)` with no host binds the IPv6 wildcard `::`, but every
 * test fetches `http://127.0.0.1:<port>`. On a busy machine another process
 * can already hold that port number on 127.0.0.1, so the request reaches
 * *its* server (a 404, in the flake that was seen) instead of ours. Binding
 * the same loopback address we fetch from makes the kernel pick a port that
 * is free there.
 */
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

export const LOOPBACK = "127.0.0.1";

/** Listen on an ephemeral port on 127.0.0.1 and return that port. */
export async function listenLoopback(server: Server): Promise<number> {
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, LOOPBACK, () => {
      server.off("error", reject);
      resolvePromise();
    });
  });
  return (server.address() as AddressInfo).port;
}
