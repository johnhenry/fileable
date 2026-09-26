/**
 * A small, dependency-free reimplementation of the exact subset of
 * `node:path/posix` this codebase uses (`join`, `dirname`, `relative`) --
 * pure string manipulation, no `node:path` import. Extracted so `layout.ts`
 * (previously the only `node:path/posix` import among the four pre-write
 * pipeline stages -- build/resolve/layout/hash) can be bundled for a
 * browser target (issue #6): Vite/esbuild replace `node:path` with an empty
 * module when targeting the browser, which silently turned every
 * `posixPath.join(...)` call into a crash (`posixPath.join is not a
 * function`).
 *
 * Behavior is verified against real `node:path/posix` output for a wide
 * range of inputs, including every shape actually seen in this codebase
 * (relative paths, no leading "/", `..`-bearing names, trailing slashes) --
 * see test/posix-path.test.ts.
 */

function normalize(path: string): string {
  if (path === "") return ".";
  const isAbsolute = path.charCodeAt(0) === 47; // "/"
  const trailingSlash = path.length > 1 && path.endsWith("/");
  const parts = path.split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (out.length > 0 && out[out.length - 1] !== "..") {
        out.pop();
      } else if (!isAbsolute) {
        out.push("..");
      }
      // Absolute path climbing past root: dropped, matching node:path/posix
      // (`path.posix.normalize("/../a")` === "/a", not "/../a").
      continue;
    }
    out.push(part);
  }
  let result = out.join("/");
  if (isAbsolute) result = `/${result}`;
  if (result === "") result = isAbsolute ? "/" : ".";
  if (trailingSlash && !result.endsWith("/")) result += "/";
  return result;
}

/** Joins path segments and normalizes the result, node:path/posix.join's exact behavior. */
export function join(...paths: string[]): string {
  const nonEmpty = paths.filter((p) => p.length > 0);
  if (nonEmpty.length === 0) return ".";
  return normalize(nonEmpty.join("/"));
}

/**
 * Returns the directory portion of `path` -- a direct port of node's own
 * posix `dirname` algorithm (scan from the end for the last non-trailing
 * separator), since normalize()-then-strip-basename doesn't reproduce its
 * exact trailing-slash/root edge cases.
 */
export function dirname(path: string): string {
  if (path.length === 0) return ".";
  const hasRoot = path.charCodeAt(0) === 47; // "/"
  let end = -1;
  let matchedSlash = true;
  for (let i = path.length - 1; i >= 1; i--) {
    if (path.charCodeAt(i) === 47) {
      if (!matchedSlash) {
        end = i;
        break;
      }
    } else {
      matchedSlash = false;
    }
  }
  if (end === -1) return hasRoot ? "/" : ".";
  return path.slice(0, end);
}

/** Rooted representation used internally by relative() -- absolute-izes without touching any real filesystem/cwd. */
function toRooted(path: string): string {
  return path.startsWith("/") ? normalize(path) : normalize(`/${path}`);
}

/** Computes the relative path from `from` to `to`, node:path/posix.relative's exact behavior for non-cwd-dependent inputs. */
export function relative(from: string, to: string): string {
  const fromAbs = toRooted(from);
  const toAbs = toRooted(to);
  if (fromAbs === toAbs) return "";
  const fromParts = fromAbs.split("/").filter(Boolean);
  const toParts = toAbs.split("/").filter(Boolean);
  let common = 0;
  while (common < fromParts.length && common < toParts.length && fromParts[common] === toParts[common]) {
    common++;
  }
  const ups = new Array(fromParts.length - common).fill("..");
  const downParts = toParts.slice(common);
  const result = [...ups, ...downParts].join("/");
  return result;
}
