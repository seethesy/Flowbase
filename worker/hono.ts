import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { z } from "zod";
import type { Actor } from "../shared/access";
import type { Bindings } from "./bindings";
import type { Db } from "./db/client";
import { DatabaseNotConfiguredError } from "./db/errors";

export type AppEnv = {
  Bindings: Bindings;
  // actor is set only behind requireActor (worker/auth.ts).
  Variables: { requestId: string; actor: Actor };
};
export type AppContext = Context<AppEnv>;

// Runs work against the database; the Worker passes withDb from worker/db/client.ts.
export type RunWithDb = <T>(
  env: Bindings,
  run: (db: Db) => Promise<T>,
) => Promise<T>;

// Unwired database access surfaces as 503 through the app's error handler.
export function runDb<T>(
  withDb: RunWithDb | undefined,
  env: Bindings,
  run: (db: Db) => Promise<T>,
): Promise<T> {
  if (!withDb) throw new DatabaseNotConfiguredError();
  return withDb(env, run);
}

export const fail = (
  c: AppContext,
  status: ContentfulStatusCode,
  code: string,
  message: string,
) => c.json({ error: { code, message, requestId: c.get("requestId") } }, status);

// A client-facing failure with its own status and code; the app's error handler
// renders it with the request id and any extra fields (e.g. duplicates).
export class ApiError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: string;
  readonly extra: Record<string, unknown>;
  constructor(
    status: ContentfulStatusCode,
    code: string,
    message: string,
    extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}
export const notFound = (what: string) =>
  new ApiError(404, "NOT_FOUND", `${what} not found.`);
export const forbidden = () =>
  new ApiError(403, "FORBIDDEN", "You don't have access to this.");

// Parses a JSON body; the first validation message becomes the error message.
export async function parseBody<S extends z.ZodType>(
  c: AppContext,
  schema: S,
): Promise<z.output<S>> {
  const parsed = schema.safeParse(await c.req.json().catch(() => undefined));
  if (!parsed.success)
    throw new ApiError(
      400,
      "INVALID_REQUEST",
      parsed.error.issues[0]?.message ?? "Invalid request.",
    );
  return parsed.data;
}
