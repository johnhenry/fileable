/**
 * Error codes -> exit codes, and turning any thrown value into a stable,
 * JSON-safe description (#25). The CLI uses this for both its text output
 * and `--json` `error` events; SDK callers can use it the same way.
 */
import { FileableError } from "./types.js";
import type { ErrorCode } from "./types.js";

export interface ErrorCodeInfo {
  /** The process exit code the CLI uses for this error. */
  exitCode: number;
  summary: string;
}

/**
 * Exit codes, shared with `@johnhenry/servable` and `@johnhenry/hostable`
 * where they overlap: 0 success; 1 the run failed (E_INTERNAL, and every
 * build-time error -- the `code` says which); 2 usage or manifest error;
 * 3 the template module couldn't be loaded; 5 Node's permission model
 * refused something (E_ACCESS_DENIED). 4 is not used by fileable (it's
 * servable's E_LISTEN).
 */
export const ERROR_CODES: Readonly<Record<ErrorCode, ErrorCodeInfo>> = Object.freeze({
  E_USAGE: { exitCode: 2, summary: "Bad command-line arguments." },
  E_MANIFEST: { exitCode: 2, summary: "fileable.config.json or package.json \"fileable\" is missing, invalid, or ambiguous." },
  E_MODULE_NOT_FOUND: { exitCode: 3, summary: "The template file doesn't exist." },
  E_MODULE_LOAD: { exitCode: 3, summary: "The template module threw while loading (syntax error, missing import), or its default-export function threw." },
  E_JSX_COMPILER: { exitCode: 3, summary: "A .tsx/.jsx module needs a JSX compiler and the project has none fileable can use." },
  E_NOT_A_TEMPLATE: { exitCode: 3, summary: "The template module has no default export." },
  E_INVALID_TREE: { exitCode: 1, summary: "The tree contains something fileable can't render (a Promise or binary JSX child, a reserved tag)." },
  E_INVALID_PROP: { exitCode: 1, summary: "A prop is missing or has an unrecognized value." },
  E_INVALID_OPTION: { exitCode: 1, summary: "An SDK option has an unrecognized value." },
  E_PATH_CONFLICT: { exitCode: 1, summary: "Two artifacts resolve to the same output path." },
  E_UNSAFE_PATH: { exitCode: 1, summary: "An output path is empty, absolute, or escapes the tree." },
  E_CONFLICT: { exitCode: 1, summary: "onConflict refused to touch a file that already exists." },
  E_SRC: { exitCode: 1, summary: "A src, from, or prop value couldn't be read, fetched, or awaited." },
  E_DECODE: { exitCode: 1, summary: "<Dir src decode> couldn't decode the archive, or an entry isn't a safe path." },
  E_EXEC_DENIED: { exitCode: 1, summary: "The cmd attribute was used without --allow-exec (allowExec: true)." },
  E_EXEC_FAILED: { exitCode: 1, summary: "The cmd command exited with an error." },
  E_SYMLINK: { exitCode: 1, summary: "A symlink can't be made (bad target, target inside an archive, or --strict fallback)." },
  E_LINK: { exitCode: 1, summary: "A linkTo() target isn't in the tree." },
  E_RM: { exitCode: 1, summary: "An <Rm> failed (onMissing=\"error\" matched nothing, or deletable() threw)." },
  E_EJECT_BINARY: { exitCode: 1, summary: "eject was asked to inline binary content as text." },
  E_BROWSER_UNSUPPORTED: { exitCode: 1, summary: "The browser entry point can't do this (filesystem, cmd, archives)." },
  E_ACCESS_DENIED: { exitCode: 5, summary: "Node's permission model refused a read, write or child process; the message names the missing --allow-* flag." },
  E_INTERNAL: { exitCode: 1, summary: "Anything else: an unexpected error, probably a bug in fileable." },
});

export const EXIT_OK = 0;

export interface ErrorDescription {
  code: ErrorCode;
  message: string;
  exitCode: number;
  /**
   * True when the run ends because of this error. Under `fileable watch`, a
   * failed build is not fatal (watching continues), so it's false there.
   */
  fatal: boolean;
  /** The tree path (or file) the error is about, when known. */
  path?: string;
  /** For E_ACCESS_DENIED: the permission scope (e.g. "FileSystemWrite", "ChildProcess") and the resource. */
  permission?: string;
  resource?: string;
  /** Messages of the underlying causes, outermost first. */
  causes?: string[];
}

interface NodeAccessError {
  code?: string;
  permission?: string;
  resource?: string;
  message?: string;
  cause?: unknown;
}

function causeChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  let current: unknown = error;
  while (current !== undefined && current !== null && chain.length < 10 && !chain.includes(current)) {
    chain.push(current);
    current = (current as { cause?: unknown }).cause;
  }
  return chain;
}

/** Node's permission scopes -> the flag that grants them. */
const ALLOW_FLAGS: Record<string, string> = {
  FileSystemRead: "--allow-fs-read",
  FileSystemWrite: "--allow-fs-write",
  ChildProcess: "--allow-child-process",
  WorkerThreads: "--allow-worker",
  Net: "--allow-net",
};

/** Describes any thrown value with a stable code, an exit code, and plain-JSON fields. */
export function describeError(error: unknown, fallback: ErrorCode = "E_INTERNAL"): ErrorDescription {
  const chain = causeChain(error);
  const denied = chain.find((e) => (e as NodeAccessError)?.code === "ERR_ACCESS_DENIED") as NodeAccessError | undefined;
  let code: ErrorCode = error instanceof FileableError ? error.code : fallback;
  let message = error instanceof Error ? error.message : String(error);
  if (denied && code !== "E_ACCESS_DENIED") {
    code = "E_ACCESS_DENIED";
    const base = ALLOW_FLAGS[denied.permission ?? ""];
    const flag = base && base.startsWith("--allow-fs-") && denied.resource ? `${base}=${denied.resource}` : base;
    message = `Node's permission model denied ${denied.permission ?? "access"}${denied.resource ? ` to ${denied.resource}` : ""}` +
      (flag ? ` -- run node with ${flag}` : "") + ` (${message})`;
  }
  const description: ErrorDescription = { code, message, fatal: true, exitCode: ERROR_CODES[code].exitCode };
  if (error instanceof FileableError) description.path = error.path;
  if (denied) {
    if (denied.permission) description.permission = denied.permission;
    if (denied.resource) description.resource = denied.resource;
  } else if (error instanceof FileableError && error.permission) {
    description.permission = error.permission;
    if (!error.path.startsWith("<")) description.resource = error.path;
  }
  const causes = chain.slice(1).map((e) => (e instanceof Error ? e.message : String(e)));
  if (causes.length > 0) description.causes = causes;
  return description;
}

interface PermissionApi {
  has(scope: string, reference?: string): boolean;
}

/** Node's permission API when the process runs with `--permission`, else undefined. */
export function permissionModel(): PermissionApi | undefined {
  return (process as { permission?: PermissionApi }).permission;
}

/**
 * Checks a permission up front, so a missing grant is reported before any
 * work starts (and with the flag to add) instead of surfacing from deep
 * inside an async fs call. No-op when the permission model is off.
 */
export function assertPermitted(scope: "fs.read" | "fs.write" | "child", resource: string | undefined, why: string): void {
  const permission = permissionModel();
  if (!permission || permission.has(scope, resource)) return;
  const names = { "fs.read": "FileSystemRead", "fs.write": "FileSystemWrite", child: "ChildProcess" } as const;
  const flag = scope === "child" ? "--allow-child-process" : `--allow-${scope.replace(".", "-")}=${resource}`;
  const error = new FileableError(`${why}, but Node's permission model doesn't allow it -- run node with ${flag}`, resource ?? `<${names[scope]}>`, undefined, "E_ACCESS_DENIED");
  error.permission = names[scope];
  throw error;
}
