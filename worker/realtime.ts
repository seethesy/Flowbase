import type { MiddlewareHandler } from "hono";
import type { Bindings } from "./bindings";
import type { AppEnv } from "./hono";
import {
  CHANGED_EVENT,
  CHANGES_CHANNEL,
  type ChangedPing,
} from "../shared/realtime";

const READS = ["GET", "HEAD", "OPTIONS"];
// Writes that change no shared record: demo echoes, the dev check, sign-in, and
// a person's own notification read state and email preferences (FLOW-43).
const UNSHARED = /^\/api\/(demo|dev|auth|notifications)\//;

// Sends the "changed" ping (FLOW-206) through Supabase Realtime's broadcast REST
// endpoint. Without Supabase configured it does nothing; clients then rely on
// the 30-second polling fallback.
export async function publishChanged(
  env: Bindings | undefined,
  send: typeof fetch = fetch,
) {
  if (!env?.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) return;
  const payload: ChangedPing = { at: new Date().toISOString() };
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

// After a successful API write, announce it. Handlers commit their transaction
// before they respond, so a 2xx means the change is committed; a rolled-back
// write answers with an error and sends nothing. The ping never delays or fails
// the response: it runs after it (waitUntil) and failures are only logged.
export function announceChanges(
  publish: (env: Bindings | undefined) => Promise<void> = publishChanged,
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
    const sent = publish(c.env).catch((error: unknown) =>
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
