import type { Context, Hono, MiddlewareHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { z } from "zod";
import type { Actor } from "../shared/access";
import { id as uuid } from "../shared/schema-primitives";
import type { ChangeArea } from "../shared/realtime";
import type { Bindings } from "./bindings";
import type { Db } from "./db/client";
import { DatabaseNotConfiguredError } from "./db/errors";
import type { CardSql, Page, PageRequest } from "./records/core/paging";

export type AppEnv = {
  Bindings: Bindings;
  // actor is set only behind requireActor (worker/auth.ts). db is the request's
  // shared database client (FLOW-306), set wherever the app has withDb.
  // actor is set only behind requireActor (worker/auth.ts).
  Variables: {
    requestId: string;
    actor: Actor;
    // Areas a write also changed, and a write that changed nothing (FLOW-304,
    // worker/realtime.ts: touches, unchanged).
    areas?: ChangeArea[];
    unchanged?: boolean;
    // A custom card's filters, sort and limit for the list query (FLOW-308,
    // worker/fields.ts); pageRequest hands it to the list's keyset paging.
    card?: CardSql;
    db?: RunWithDb
  };
};
export type AppContext = Context<AppEnv>;

// Runs work against the database; the Worker passes withDb from worker/db/client.ts.
export type RunWithDb = <T>(
  env: Bindings,
  run: (db: Db) => Promise<T>,
) => Promise<T>;

// Unwired database access surfaces as 503 through the app's error handler.
// Inside a request the work shares the request's one client (FLOW-306).
export function runDb<T>(
  withDb: RunWithDb | undefined,
  c: AppContext,
  run: (db: Db) => Promise<T>,
): Promise<T> {
  if (!withDb) throw new DatabaseNotConfiguredError();
  return (c.get("db") ?? withDb)(c.env, run);
}

// Work after the response: waitUntil in Workers, awaited where there is no
// execution context (tests and local requests).
export async function afterResponse(c: AppContext, task: Promise<unknown>) {
  let ctx: { waitUntil: (promise: Promise<unknown>) => void } | undefined;
  try {
    ctx = c.executionCtx;
  } catch {
    // No execution context outside the Workers runtime.
  }
  if (ctx) ctx.waitUntil(task);
  else await task;
}

// Runs a record function with the database and the signed-in actor (FLOW-192).
// Each router makes one from its withDb option and uses it behind requireActor:
//   const record = recordRunner(options.withDb);
//   c.json(await record(c, (db, actor) => getClient(db, actor, id)))
export const recordRunner =
  (withDb: RunWithDb | undefined) =>
  <T>(c: AppContext, run: (db: Db, actor: Actor) => Promise<T>): Promise<T> =>
    runDb(withDb, c, (db) => run(db, c.get("actor")));

// Archive and restore routes (FLOW-313): POST <path>/archive and
// <path>/restore, each behind the router's policy middleware. `set` is the
// record function, which checks access and writes the audit row in its
// transaction; `check` runs first with the request, for a router's own rule.
export function archiveRoutes<T>(
  routes: Hono<AppEnv>,
  record: ReturnType<typeof recordRunner>,
  options: {
    path: string;
    what: string;
    guard: MiddlewareHandler<AppEnv>;
    set: (db: Db, actor: Actor, id: string, archived: boolean) => Promise<T>;
    check?: (c: AppContext, db: Db, actor: Actor, id: string) => Promise<void>;
  },
) {
  for (const [action, archived] of [
    ["archive", true],
    ["restore", false],
  ] as const)
    routes.post(`${options.path}/${action}`, options.guard, async (c) => {
      const id = idParam(c, options.what);
      return c.json(
        await record(c, async (db, actor) => {
          await options.check?.(c, db, actor, id);
          return options.set(db, actor, id, archived);
        }),
      );
    });
}

// A record's history (FLOW-41, FLOW-313): GET <path>/history, one page of its
// audit rows, behind the router's policy middleware.
export function historyRoute<T>(
  routes: Hono<AppEnv>,
  record: ReturnType<typeof recordRunner>,
  options: {
    path: string;
    what: string;
    guard: MiddlewareHandler<AppEnv>;
    read: (db: Db, actor: Actor, id: string, page: PageRequest) => Promise<Page<T>>;
  },
) {
  routes.get(`${options.path}/history`, options.guard, async (c) => {
    const id = idParam(c, options.what);
    return sendPage(c, await record(c, (db, actor) => options.read(db, actor, id, pageRequest(c))));
  });
}

// List paging (FLOW-179): ?cursor=&limit= in, the page's rows as the JSON body
// (unchanged shape) with X-Has-More and, when there is one, X-Next-Cursor.
export function pageRequest(c: AppContext): PageRequest {
  const card = c.get("card");
  if (card) return { card };
  const limit = Number(c.req.query("limit"));
  return {
    cursor: queryParam(c, "cursor"),
    limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
  };
}
export function sendPage<T>(c: AppContext, page: Page<T>) {
  c.header("X-Has-More", page.next ? "true" : "false");
  if (page.next) c.header("X-Next-Cursor", page.next);
  return c.json(page.rows);
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

// A route's uuid parameter (FLOW-313); anything else is a 404 for `what`.
export function idParam(c: AppContext, what: string, name = "id"): string {
  const parsed = uuid.safeParse(c.req.param(name));
  if (!parsed.success) throw notFound(what);
  return parsed.data;
}
// A query string value, with an empty one read as absent (FLOW-313).
export const queryParam = (c: AppContext, key: string) =>
  c.req.query(key) || undefined;

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

// Version-checked saves (FLOW-186). `stored` is the record's updated_at, read
// under the row lock in the saving transaction; `loaded` is the updatedAt the
// user's copy had. A mismatch is a stale save: 409 STALE, nothing changes. The
// PUT routes always pass one (withVersion); server-side callers such as module
// importers have no loaded copy and pass none.
export function requireVersion(
  stored: Date,
  loaded: string | undefined,
  what: string,
) {
  if (loaded !== undefined && stored.getTime() !== Date.parse(loaded))
    throw new ApiError(
      409,
      "STALE",
      `This ${what} changed since you opened it. Load the current version and make your changes again.`,
    );
}
