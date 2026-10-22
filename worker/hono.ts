import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
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
