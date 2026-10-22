import type { MiddlewareHandler } from "hono";
import type { Actor } from "../shared/access";
import { fail, type AppContext, type AppEnv } from "./hono";
import { can, type Action } from "./policy";

// Who is calling. Sign-in (FLOW-36) will verify the Supabase JWT here; until then the
// Worker wires no resolver, so every protected route answers 401. Tests inject one.
export type ResolveActor = (c: AppContext) => Promise<Actor | null>;

export function requireActor(resolve?: ResolveActor): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const actor = resolve ? await resolve(c) : null;
    if (!actor) return fail(c, 401, "UNAUTHENTICATED", "Sign-in is required.");
    c.set("actor", actor);
    await next();
  };
}

export function requirePermission(action: Action): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!can(c.get("actor"), action))
      return fail(c, 403, "FORBIDDEN", "You don't have access to this.");
    await next();
  };
}
