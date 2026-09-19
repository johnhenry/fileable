/**
 * Demonstrates `onConflict="append"` on <File>: instead of the default
 * "replace" (unconditional overwrite), each run appends one line to
 * build-log.txt rather than clobbering the previous run's entry -- so the
 * log grows across separate `fileable build` invocations.
 *
 * Run with:
 *   npm run build && node dist/bin/fileable.js build dist/examples/04-build-log/template.js
 *   node dist/bin/fileable.js build dist/examples/04-build-log/template.js --var message="second run"
 *
 * Run it a few times (optionally with different --var message values) and
 * watch dist/build-log.txt grow one line per run instead of staying at one.
 */
import { Dir, File } from "fileable";

interface Vars {
  message?: string;
}

export default function template(vars: Vars = {}) {
  const timestamp = new Date().toISOString();
  const message = vars.message ?? "build ran";

  return (
    <Dir name="dist">
      <File name="build-log.txt" onConflict="append">
        {`[${timestamp}] ${message}\n`}
      </File>
    </Dir>
  );
}
