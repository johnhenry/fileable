/**
 * `--var key[:type]=value` parsing for the CLI, so template functions get
 * real typed values (numbers, booleans, JSON) instead of every value
 * arriving as a raw string that the template has to coerce itself.
 * TypeScript-like annotation syntax (`key:type=value`) since that's the
 * type-annotation shape template authors already read/write every day.
 */
export type VarType = "string" | "number" | "boolean" | "json";

const VAR_TYPES: ReadonlySet<string> = new Set(["string", "number", "boolean", "json"]);

/** Parses one `--var` flag's raw argument into a [key, value] pair. */
export function parseVarFlag(raw: string): [string, unknown] {
  const eqIndex = raw.indexOf("=");
  const keyAndType = eqIndex === -1 ? raw : raw.slice(0, eqIndex);
  const rawValue = eqIndex === -1 ? undefined : raw.slice(eqIndex + 1);

  const colonIndex = keyAndType.indexOf(":");
  const key = colonIndex === -1 ? keyAndType : keyAndType.slice(0, colonIndex);
  const typeName = colonIndex === -1 ? undefined : keyAndType.slice(colonIndex + 1);

  if (!key) {
    throw new Error(`invalid --var "${raw}" -- expected key[:type]=value`);
  }
  if (typeName !== undefined && !VAR_TYPES.has(typeName)) {
    throw new Error(`invalid --var "${raw}" -- unknown type "${typeName}" (expected string|number|boolean|json)`);
  }
  const type = (typeName ?? "string") as VarType;

  if (rawValue === undefined) {
    // `--var draft` or `--var draft:boolean` (no "=value") is shorthand for
    // `true` -- anything else needs an explicit value.
    if (typeName === undefined || type === "boolean") return [key, true];
    throw new Error(`invalid --var "${raw}" -- type "${type}" requires a value (key:${type}=value)`);
  }

  return [key, coerceVarValue(raw, type, rawValue)];
}

function coerceVarValue(raw: string, type: VarType, value: string): unknown {
  switch (type) {
    case "string":
      return value;
    case "number": {
      const n = Number(value);
      if (Number.isNaN(n)) throw new Error(`invalid --var "${raw}" -- "${value}" is not a valid number`);
      return n;
    }
    case "boolean": {
      const lower = value.toLowerCase();
      if (lower === "true") return true;
      if (lower === "false") return false;
      throw new Error(`invalid --var "${raw}" -- "${value}" is not "true" or "false"`);
    }
    case "json":
      try {
        return JSON.parse(value);
      } catch (cause) {
        throw new Error(`invalid --var "${raw}" -- not valid JSON: ${(cause as Error).message}`);
      }
  }
}
