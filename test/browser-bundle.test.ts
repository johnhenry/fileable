/**
 * Regression test for issue #8: `linkTo`/`warn`/`markdownToHtml`/
 * `drainBuildContext` must be importable from `@johnhenry/fileable/browser`
 * without dragging any `node:*` specifier into a real browser bundle.
 *
 * Bundles a scratch entry that imports exactly these four (plus `plan`,
 * the entry point's own pre-existing export, thrown in so the bundle also
 * exercises the rest of the browser-safe graph at the same time) from the
 * compiled `dist/src/browser/index.js`, using esbuild's *real* resolver
 * with `platform: "browser"` -- not a mock, not code inspection. Written
 * against the compiled entry point (same convention as every other
 * browser/* test in this suite, e.g. test/browser-plan.test.ts), so a
 * regression that only shows up post-`tsc` is still caught.
 *
 * Before this fix, `api.ts` imported `glob` at module load time, which
 * `glob` itself pulls `node:events`/`node:fs`/`node:path`/`node:url` in
 * behind -- so this exact esbuild call failed with `Could not resolve
 * "node:events"` (among others), even though neither `linkTo` nor `warn`
 * touches `glob` at all, and `markdownToHtml`/`drainBuildContext` weren't
 * reachable from `./browser` at all yet (a plain "no matching export"
 * resolve error). Confirmed by hand while building this fix: reverting
 * src/api.ts's lazy `glob` load and src/browser/index.ts's four new
 * re-exports and re-running this exact check reproduces both failures;
 * restoring the fix makes it pass again -- so this is a real regression
 * guard, not a tautology that would pass with or without the fix.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const browserEntry = fileURLToPath(new URL("../src/browser/index.js", import.meta.url));

test("esbuild --platform=browser bundles linkTo/warn/markdownToHtml/drainBuildContext from @johnhenry/fileable/browser with zero node:* specifiers", async () => {
  const scratchDir = mkdtempSync(join(tmpdir(), "fileable-browser-bundle-"));
  try {
    const entryFile = join(scratchDir, "entry.mjs");
    writeFileSync(
      entryFile,
      [
        `import { linkTo, warn, markdownToHtml, drainBuildContext, plan } from ${JSON.stringify(browserEntry)};`,
        `export { linkTo, warn, markdownToHtml, drainBuildContext, plan };`,
        "",
      ].join("\n"),
    );

    const result = await esbuild.build({
      entryPoints: [entryFile],
      bundle: true,
      platform: "browser",
      format: "esm",
      write: false,
    });

    assert.equal(result.errors.length, 0, `expected a clean bundle, got errors: ${JSON.stringify(result.errors)}`);
    const code = result.outputFiles[0].text;

    // The actual bug: a Node-only specifier (glob's own node:events et al.)
    // resolved into the bundle. esbuild would have already thrown above if
    // platform=browser genuinely couldn't resolve one -- this is defense in
    // depth against, e.g., a future change that swaps in a bundler-visible
    // optional/dynamic node: import that still happens to resolve.
    assert.doesNotMatch(code, /["']node:[a-zA-Z0-9/]+["']/, "bundle output must not reference any node:* specifier");

    // The other half of the regression: exports silently missing (would
    // fail at the esbuild.build() resolve step above with "no matching
    // export"), or present but dead-code-eliminated to nothing.
    for (const name of ["linkTo", "warn", "markdownToHtml", "drainBuildContext"]) {
      assert.match(code, new RegExp(`function ${name}\\b`), `expected ${name}'s implementation in the bundle output`);
    }
  } finally {
    rmSync(scratchDir, { recursive: true, force: true });
  }
});
