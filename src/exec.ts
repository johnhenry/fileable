/**
 * Executes the `cmd` attribute's shell command and returns its stdout.
 * Gating on `allowExec` happens in resolve.ts, one level up -- this module
 * assumes the caller has already authorized execution (PRD SS7.1).
 */
import { exec, type ExecException } from "node:child_process";

export function execCommand(cmd: string, cwd: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    exec(cmd, { cwd, encoding: "utf8" }, (error: ExecException | null, stdout: string) => {
      if (error) {
        reject(error);
        return;
      }
      resolvePromise(stdout);
    });
  });
}
