/**
 * Executes the `cmd` attribute's shell command and returns its raw stdout
 * bytes. Gating on `allowExec` happens in resolve.ts, one level up -- this
 * module assumes the caller has already authorized execution (PRD SS7.1).
 *
 * Returns a Buffer, not a UTF-8 string -- forcing `encoding: "utf8"` here
 * would silently corrupt a command whose stdout is binary (see
 * content-util.ts); resolve.ts decides text-vs-binary uniformly for both
 * `src` and `cmd`.
 */
import { exec, type ExecException } from "node:child_process";

export function execCommand(cmd: string, cwd: string): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    exec(cmd, { cwd, encoding: "buffer" }, (error: ExecException | null, stdout: Buffer) => {
      if (error) {
        reject(error);
        return;
      }
      resolvePromise(stdout);
    });
  });
}
