import type { Context, MiddlewareHandler } from "hono";
import type { Bindings } from "./bindings";
import type { AppEnv } from "./hono";
import {
  CHANGED_AREAS_HEADER,
  CHANGED_EVENT,
  CHANGES_CHANNEL,
  type ChangeArea,
  type ChangedPing,
} from "../shared/realtime";

const READS = ["GET", "HEAD", "OPTIONS"];
// Writes that change no shared record: demo echoes, the dev check, sign-in, and
// a person's own notification read state and email preferences (FLOW-43).
const UNSHARED = /^\/api\/(demo|dev|auth|notifications)\//;
// Writes that change nothing anyone else sees (FLOW-304): the activity
// tracker's minute-by-minute session posts (FLOW-119) and the read-only
// regeneration previews, which only compute what a regeneration would do.
const NO_PING = [
  /^\/api\/time\/sessions\/?$/,
  /^\/api\/events\/[^/]+\/planning\/outputs\/[^/]+\/preview\/?$/,
  /^\/api\/events\/[^/]+\/(pull-list|kitchen-menu)\/regenerate\/preview\/?$/,
];

// The areas a write changes (FLOW-304), by the router's mount path: the first
// matching rule wins, so sub-paths that also change other areas come first. A
// handler adds more with `touches`. A path no rule covers pings without areas,
// which refetches everything, as before areas existed.
const ROUTE_AREAS: [RegExp, ChangeArea[]][] = [
  [/^\/api\/admin\/users(\/|$)/, ["users", "staff"]],
  [/^\/api\/admin(\/|$)/, ["settings"]],
  // Converting a lead or adding its event creates the client and the event.
  [/^\/api\/leads\/[^/]+\/(convert|events)(\/|$)/, ["leads", "clients", "events", "tasks", "inventory"]],
  [/^\/api\/leads(\/|$)/, ["leads"]],
  [/^\/api\/ingest(\/|$)/, ["leads", "communications"]],
  [/^\/api\/communications(\/|$)/, ["communications"]],
  [/^\/api\/(clients|venues)(\/|$)/, ["clients"]],
  // An event's kitchen menu, recipes and bar plan feed the kitchen screens.
  [/^\/api\/events\/[^/]+\/(kitchen-menu|recipes|bar-plan)(\/|$)/, ["events", "kitchen", "inventory", "tasks", "production"]],
  [/^\/api\/events\/[^/]+\/(staff|timeline|trucks)(\/|$)/, ["events", "staff", "tasks", "production"]],
  // An event save can schedule planning (tasks and inventory holds) and the
  // production scan.
  [/^\/api\/(events|reservations|beos|offline-beos|day-of|calendar)(\/|$)/, ["events", "tasks", "inventory", "production"]],
  [/^\/api\/google-calendar(\/|$)/, ["events", "settings"]],
  [/^\/api\/proposals(\/|$)/, ["proposals", "events", "sales"]],
  [/^\/api\/approvals(\/|$)/, ["approvals", "proposals", "events"]],
  [/^\/api\/sales(\/|$)/, ["sales"]],
  [/^\/api\/(inventory|order-lists)(\/|$)/, ["inventory", "vendors"]],
  [/^\/api\/vendors(\/|$)/, ["vendors", "inventory"]],
  [/^\/api\/(recipes|kitchen)(\/|$)/, ["kitchen", "events"]],
  [/^\/api\/tasks(\/|$)/, ["tasks", "production"]],
  [/^\/api\/production(\/|$)/, ["production", "events"]],
  [/^\/api\/(documents|attachments|photos|sops)(\/|$)/, ["documents"]],
  [/^\/api\/staff(\/|$)/, ["staff", "users"]],
  [/^\/api\/(staff-pay|time)(\/|$)/, ["time", "staff"]],
  // Roles and permissions change what everyone may see.
  [/^\/api\/(settings|permissions)(\/|$)/, ["settings"]],
  [/^\/api\/layout(\/|$)/, ["layout"]],
  [/^\/api\/copy(\/|$)/, ["copy"]],
];
export function routeAreas(path: string): ChangeArea[] | null {
  return ROUTE_AREAS.find(([pattern]) => pattern.test(path))?.[1] ?? null;
}

// A handler's write also changes these areas (FLOW-304).
export function touches(c: Context<AppEnv>, ...areas: ChangeArea[]) {
  c.set("areas", [...(c.get("areas") ?? []), ...areas]);
}
// The handler's write changed nothing (a reset of what was never saved): no
// ping, and the browser that sent it marks nothing stale.
export function unchanged(c: Context<AppEnv>) {
  c.set("unchanged", true);
}

// Sends the "changed" ping (FLOW-206) through Supabase Realtime's broadcast REST
// endpoint. Without Supabase configured it does nothing; clients then rely on
// the 30-second polling fallback.
export async function publishChanged(
  env: Bindings | undefined,
  areas: ChangeArea[] | null = null,
  send: typeof fetch = fetch,
) {
  if (!env?.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) return;
  const payload: ChangedPing = {
    at: new Date().toISOString(),
    ...(areas && { areas }),
  };
  const response = await send(
    `${env.SUPABASE_URL.replace(/\/$/, "")}/realtime/v1/api/broadcast`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: env.SUPABASE_SECRET_KEY,
        // A legacy service-role key is a JWT and also goes in Authorization;
        // a new sb_secret_ key is accepted only as the apikey.
        ...(!env.SUPABASE_SECRET_KEY.startsWith("sb_") && {
          Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
        }),
      },
      body: JSON.stringify({
        messages: [{ topic: CHANGES_CHANNEL, event: CHANGED_EVENT, payload }],
      }),
    },
  );
  if (!response.ok)
    throw new Error(`Realtime broadcast failed (${response.status}).`);
}

const setAreasHeader = (c: Context<AppEnv>, areas: ChangeArea[]) => {
  try {
    c.res.headers.set(CHANGED_AREAS_HEADER, areas.join(","));
  } catch {
    // A response with immutable headers keeps the browser's fallback.
  }
};

// After a successful API write, announce it with the areas it changed. Handlers
// commit their transaction before they respond, so a 2xx means the change is
// committed; a rolled-back write answers with an error and sends nothing. The
// ping never delays or fails the response: it runs after it (waitUntil) and
// failures are only logged.
export function announceChanges(
  publish: (env: Bindings | undefined, areas: ChangeArea[] | null) => Promise<void> = publishChanged,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    await next();
    if (
      READS.includes(c.req.method) ||
      UNSHARED.test(c.req.path) ||
      c.res.status < 200 ||
      c.res.status >= 300
    )
      return;
    if (c.get("unchanged") || NO_PING.some((pattern) => pattern.test(c.req.path))) {
      setAreasHeader(c, []);
      return;
    }
    const declared = routeAreas(c.req.path);
    const areas = declared ? [...new Set([...declared, ...(c.get("areas") ?? [])])] : null;
    if (areas) setAreasHeader(c, areas);
    const sent = publish(c.env, areas).catch((error: unknown) =>
      console.error(
        JSON.stringify({
          event: "realtime_ping_failed",
          requestId: c.get("requestId"),
          message: error instanceof Error ? error.message : String(error),
        }),
      ),
    );
    let ctx: { waitUntil: (promise: Promise<unknown>) => void } | undefined;
    try {
      ctx = c.executionCtx;
    } catch {
      // No execution context outside the Workers runtime (tests): wait here.
    }
    if (ctx) ctx.waitUntil(sent);
    else await sent;
  };
}
