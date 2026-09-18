/**
 * Fileable is a one-shot, single-process build tool (PRD SS1.3 non-goals rule
 * out a plugin/middleware system, and the worked example in SS9 calls
 * `useCollection()`/`glob()`/`warn()` at module top level, *before* `render()`
 * exists to establish any per-call context). So this is deliberately a plain
 * module-level singleton, not per-render-call state: `render()` reads and
 * clears it around each build. Concurrent `render()` calls in the same
 * process share one registry -- an accepted limitation for a build-time CLI
 * tool, not a web server.
 */

const state = {
  warnings: [] as string[],
  collectionPatterns: new Set<string>(),
};

export function recordWarning(message: string): void {
  state.warnings.push(message);
}

export function recordCollectionDependency(pattern: string): void {
  state.collectionPatterns.add(pattern);
}

export function drainBuildContext(): { warnings: string[]; collectionPatterns: string[] } {
  const warnings = state.warnings.slice();
  const collectionPatterns = Array.from(state.collectionPatterns);
  state.warnings.length = 0;
  state.collectionPatterns.clear();
  return { warnings, collectionPatterns };
}
