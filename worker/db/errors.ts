export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super("The HYPERDRIVE binding is not configured.");
    this.name = "DatabaseNotConfiguredError";
  }
}

// SQLSTATE of a Postgres error, also when Drizzle wraps it (DrizzleQueryError keeps
// the postgres.js error as its cause). Recognised by shape, not class name, which
// bundling may rename: postgres.js copies the server's fields, including severity
// and the five-character code, onto the error.
export function postgresErrorCode(error: unknown): string | undefined {
  let current = error;
  for (let depth = 0; current instanceof Error && depth < 5; depth++) {
    const fields = current as Error & { code?: unknown; severity?: unknown };
    if (
      typeof fields.code === "string" &&
      /^[0-9A-Z]{5}$/.test(fields.code) &&
      typeof fields.severity === "string"
    )
      return fields.code;
    current = current.cause;
  }
  return undefined;
}

// Constraint violations the API answers as client errors (FLOW-187): a unique
// violation (two users saving the same item code at once) is a 409, a CHECK
// violation (an unknown status, negative stock) a 400.
export const constraintErrors: Record<
  string,
  { status: 400 | 409; code: string; message: string }
> = {
  "23505": {
    status: 409,
    code: "ALREADY_EXISTS",
    message: "This conflicts with a record that already exists. Reload and try again.",
  },
  "23514": {
    status: 400,
    code: "INVALID_VALUE",
    message: "A value is not allowed.",
  },
};
