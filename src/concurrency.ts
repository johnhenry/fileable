/**
 * Bounded-concurrency helpers for the write stage (issue #22). No runtime
 * dependency, no `node:*` import.
 */

/** How many filesystem operations the write stage keeps in flight at once. */
export const IO_CONCURRENCY = 64;

/**
 * `Promise.all(items.map(fn))` with at most `limit` calls of `fn` running at
 * once, results in input order. Items are started strictly in input order.
 *
 * On failure no further items are started, but every call already in flight
 * is awaited before this rejects -- nothing keeps running (or rejects
 * unhandled) after the caller has seen the error. The error thrown is the
 * one from the *lowest-index* failing item: since items start in order and
 * all in-flight items have settled, every item before it has run, so this
 * is the same error a sequential loop would have stopped on.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failedIndex = -1;
  let failure: unknown;

  async function worker(): Promise<void> {
    while (failedIndex === -1 && next < items.length) {
      const index = next++;
      try {
        results[index] = await fn(items[index], index);
      } catch (error) {
        if (failedIndex === -1 || index < failedIndex) {
          failedIndex = index;
          failure = error;
        }
      }
    }
  }

  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(Math.max(1, limit), items.length); i++) workers.push(worker());
  await Promise.all(workers);
  if (failedIndex !== -1) throw failure;
  return results;
}
