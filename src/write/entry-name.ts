/**
 * The encoders' half of #31: `encode="zip"`/`"wbn"` refuse to put a name in
 * the archive they produce that the decoders (and other extractors) would
 * have to refuse -- the same rule as `<Dir src decode>` uses,
 * `unsafeArchivePathReason()`. Layout already refuses these paths, so this
 * is a second check right where the bytes are produced, in case a future
 * path into the writers skips layout.
 */
import { unsafeArchivePathReason } from "../archive-path.js";
import { FileableError } from "../types.js";

export function assertSafeEntryName(name: string, format: "zip" | "wbn", containerPath: string): void {
  const reason = unsafeArchivePathReason(name);
  if (reason === undefined) return;
  throw new FileableError(
    `unsafe output path ${JSON.stringify(name)} (${reason}) -- encode="${format}" won't write it into ${containerPath}; an archive entry name must be a relative path that stays inside the archive`,
    `${containerPath}::${name}`, undefined, "E_UNSAFE_PATH",
  );
}
