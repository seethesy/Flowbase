import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";
import {
  authConfigSchema,
  inviteInputSchema,
  userActionSchema,
} from "../../shared/users";
import { id as uuid } from "../../shared/schema-primitives";
import { requirePermission } from "../auth";
import {
  ApiError,
  parseBody,
  recordRunner,
  type AppEnv,
  type RunWithDb,
} from "../hono";
import { changeUser, inviteUser, listUsers, toUser } from "../records/users";
import { users } from "../db/schema";
import { eq } from "drizzle-orm";
import type { Bindings } from "../bindings";

function mailer(env: Bindings) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY || !env.APP_URL)
    throw new ApiError(
      503,
      "INVITES_NOT_CONFIGURED",
      "Invitation delivery is not configured.",
    );
  const client = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return async (email: string) => {
    const { error } = await client.auth.admin.inviteUserByEmail(email, {
      redirectTo: env.APP_URL,
    });
    if (error)
      throw new ApiError(
        502,
        "INVITE_DELIVERY_FAILED",
        "The invitation is saved, but its email couldn't be sent. Use Resend invite to retry.",
      );
  };
}

export function authRoutes(options: { withDb?: RunWithDb }) {
  const routes = new Hono<AppEnv>();
  const record = recordRunner(options.withDb);
  routes.get("/config", (c) => {
    const config = authConfigSchema.safeParse({
      url: c.env?.SUPABASE_URL,
      publishableKey: c.env?.SUPABASE_PUBLISHABLE_KEY,
    });
    c.header("Cache-Control", "no-store");
    if (!config.success)
      throw new ApiError(
        503,
        "AUTH_NOT_CONFIGURED",
        "Sign-in is not configured.",
      );
    return c.json(config.data);
  });
  routes.get("/me", async (c) => {
    const user = await record(c, async (db, actor) => {
      const [row] = await db
        .select()
        .from(users)
        .where(eq(users.id, actor.userId));
      if (!row)
        throw new ApiError(401, "UNAUTHENTICATED", "Sign-in is required.");
      return toUser(row);
    });
    c.header("Cache-Control", "no-store");
    return c.json(user);
  });
  return routes;
}

export function userRoutes(options: { withDb?: RunWithDb }) {
  const routes = new Hono<AppEnv>();
  const record = recordRunner(options.withDb);
  routes.use("*", requirePermission("users.manage"));
  routes.get("/", async (c) =>
    c.json(await record(c, (db) => listUsers(db))),
  );
  routes.post("/", async (c) => {
    const input = await parseBody(c, inviteInputSchema);
    const send = mailer(c.env);
    const user = await record(c, (db, actor) =>
      inviteUser(db, actor, input),
    );
    await send(user.email);
    return c.json(user, 201);
  });
  routes.post("/:id/:action", async (c) => {
    const id = uuid.safeParse(c.req.param("id"));
    const action = userActionSchema.safeParse(c.req.param("action"));
    if (!id.success || !action.success)
      throw new ApiError(400, "INVALID_REQUEST", "Invalid user action.");
    const send = action.data === "resend" ? mailer(c.env) : null;
    const user = await record(c, (db, actor) =>
      changeUser(db, actor, id.data, action.data),
    );
    if (send) await send(user.email);
    return c.json(user);
  });
  return routes;
}
