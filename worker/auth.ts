import type { MiddlewareHandler } from "hono";
import type { Actor } from "../shared/access";
import { fail, type AppContext, type AppEnv } from "./hono";
import { can, type Action } from "./policy";
import {
  createRemoteJWKSet,
  decodeProtectedHeader,
  jwtVerify,
  decodeJwt,
  type JWTPayload,
} from "jose";
import { createClient } from "@supabase/supabase-js";
import { identitySchema, resolveUser } from "./records/users";
import { ApiError, runDb, type RunWithDb } from "./hono";
import type { Bindings } from "./bindings";

// Tests may inject a resolver. Deployed requests always use the verifier below.
export type ResolveActor = (c: AppContext) => Promise<Actor | null>;

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
export async function verifyGoogleToken(
  token: string,
  env: Bindings,
): Promise<JWTPayload | null> {
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY)
    throw new ApiError(
      503,
      "AUTH_NOT_CONFIGURED",
      "Sign-in is not configured.",
    );
  const issuer = `${env.SUPABASE_URL.replace(/\/$/, "")}/auth/v1`;
  try {
    const header = decodeProtectedHeader(token);
    let claims: JWTPayload;
    if (header.alg === "HS256") {
      // Legacy projects verify with Supabase, never with a browser-visible key.
      const client = createClient(
        env.SUPABASE_URL,
        env.SUPABASE_PUBLISHABLE_KEY,
        {
          auth: { persistSession: false, autoRefreshToken: false },
        },
      );
      const { data, error } = await client.auth.getUser(token);
      if (error || !data.user) return null;
      claims = decodeJwt(token);
      if (data.user.id !== claims.sub) return null;
    } else {
      let keys = keySets.get(issuer);
      if (!keys) {
        keys = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
        keySets.set(issuer, keys);
      }
      claims = (
        await jwtVerify(token, keys, {
          issuer,
          audience: "authenticated",
          algorithms: ["ES256", "RS256"],
        })
      ).payload;
    }
    const now = Date.now() / 1000;
    const metadata = claims.app_metadata as
      { providers?: string[] } | undefined;
    const methods = claims.amr as { method?: string }[] | undefined;
    if (
      claims.iss !== issuer ||
      claims.aud !== "authenticated" ||
      claims.role !== "authenticated" ||
      typeof claims.exp !== "number" ||
      claims.exp <= now ||
      (typeof claims.nbf === "number" && claims.nbf > now) ||
      !Array.isArray(metadata?.providers) ||
      !metadata.providers.includes("google") ||
      !Array.isArray(methods) ||
      !methods.some((m) => m.method === "oauth")
    )
      return null;
    return claims;
  } catch {
    return null;
  }
}

export function createActorResolver(withDb?: RunWithDb): ResolveActor {
  return async (c) => {
    const match = /^Bearer ([^\s]+)$/i.exec(
      c.req.header("Authorization") ?? "",
    );
    if (!match) return null;
    const claims = await verifyGoogleToken(match[1], c.env);
    if (!claims) return null;
    const meta = claims.user_metadata as
      { full_name?: string; name?: string } | undefined;
    const identity = identitySchema.safeParse({
      sub: claims.sub,
      email: claims.email,
      name: meta?.full_name ?? meta?.name,
    });
    if (!identity.success) return null;
    const actor = await runDb(withDb, c.env, (db) =>
      resolveUser(db, identity.data),
    );
    if (!actor)
      throw new ApiError(
        403,
        "ACCOUNT_NOT_ALLOWED",
        "Your account isn't invited or is inactive. Contact your Admin.",
      );
    return actor;
  };
}

const actorGuards = new WeakSet<object>();
export const isActorGuard = (handler: object) => actorGuards.has(handler);

export function requireActor(
  resolve?: ResolveActor,
): MiddlewareHandler<AppEnv> {
  const guard: MiddlewareHandler<AppEnv> = async (c, next) => {
    if (c.get("actor")) {
      await next();
      return;
    }
    const actor = resolve ? await resolve(c) : null;
    if (!actor) return fail(c, 401, "UNAUTHENTICATED", "Sign-in is required.");
    c.set("actor", actor);
    await next();
  };
  actorGuards.add(guard);
  return guard;
}

// Metadata belongs to the actual middleware used by Hono, so the route audit
// cannot be satisfied by maintaining a separate list of supposedly guarded URLs.
const permissionGuards = new WeakMap<object, Action>();
export const permissionOf = (handler: object) => permissionGuards.get(handler);
export function requirePermission(action: Action): MiddlewareHandler<AppEnv> {
  const guard: MiddlewareHandler<AppEnv> = async (c, next) => {
    if (!c.get("actor") || !can(c.get("actor"), action))
      return fail(c, 403, "FORBIDDEN", "You don't have access to this.");
    await next();
  };
  permissionGuards.set(guard, action);
  return guard;
}
