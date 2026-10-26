import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT, type JWTPayload } from "jose";
import { createApp } from "../../worker/app";
import { verifyGoogleToken } from "../../worker/auth";
import type { RunWithDb } from "../../worker/hono";
import type { Db } from "../../worker/db/client";
import { resolveUser } from "../../worker/records/users";
import { roleSchema } from "../../shared/access";
import { nextUserStatus } from "../../shared/users";
import { testSigningKey } from "../e2e/test-auth";

vi.mock("../../worker/records/users", async (original) => ({
  ...(await original<typeof import("../../worker/records/users")>()),
  resolveUser: vi.fn(),
}));
const env = {
  ASSETS: { fetch },
  SUPABASE_URL: "https://auth-test.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "public-test-key",
};
const id = "10000000-0000-4000-8000-000000000001";
const issuer = `${env.SUPABASE_URL}/auth/v1`;
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
beforeAll(async () => {
  keys = await generateKeyPair("ES256");
  const jwk = {
    ...(await exportJWK(keys.publicKey)),
    kid: "test-key",
    alg: "ES256",
    use: "sig",
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ keys: [jwk] })),
  );
});
afterAll(() => vi.unstubAllGlobals());
const token = (claims: JWTPayload = {}) =>
  new SignJWT({
    sub: id,
    email: "invited@gmail.com",
    role: "authenticated",
    iss: issuer,
    aud: "authenticated",
    exp: Math.floor(Date.now() / 1000) + 3600,
    app_metadata: { providers: ["google"] },
    amr: [{ method: "oauth" }],
    user_metadata: { full_name: "Invited Staff" },
    ...claims,
  })
    .setProtectedHeader({ alg: "ES256", kid: "test-key" })
    .sign(keys.privateKey);

it("verifies a real signature and accepts an invited personal Google account", async () => {
  const jwt = await token();
  expect(await verifyGoogleToken(jwt, env)).toMatchObject({
    sub: id,
    email: "invited@gmail.com",
  });
  vi.mocked(resolveUser).mockResolvedValue({
    userId: id,
    role: "staff",
    employmentType: "part_time",
  });
  const withDb: RunWithDb = (_env, run) => run({} as Db);
  const response = await createApp({ withDb }).request(
    "/api/demo/clients",
    { headers: { Authorization: `Bearer ${jwt}` } },
    env,
  );
  expect(response.status).toBe(200);
  expect(
    (
      await createApp({ withDb }).request(
        "/api/admin/users",
        { headers: { Authorization: `Bearer ${jwt}` } },
        env,
      )
    ).status,
  ).toBe(403);
  expect(resolveUser).toHaveBeenCalledWith(expect.anything(), {
    sub: id,
    email: "invited@gmail.com",
    name: "Invited Staff",
  });
});
it.each([
  { exp: 1 },
  { aud: "other-app" },
  { iss: "https://other.supabase.co/auth/v1" },
  { nbf: Math.floor(Date.now() / 1000) + 600 },
  { role: "service_role" },
  { app_metadata: { providers: ["email"] } },
  { amr: [{ method: "password" }] },
])("refuses invalid claims: %j", async (claims) => {
  expect(await verifyGoogleToken(await token(claims), env)).toBeNull();
});
it("refuses tampered signatures, malformed and missing tokens before accessing the database", async () => {
  const good = await token();
  const [header, payload] = good.split(".");
  const db = vi.fn<RunWithDb>();
  const app = createApp({ withDb: db as unknown as RunWithDb });
  for (const authorization of [
    undefined,
    "Basic x",
    "Bearer bad",
    `Bearer ${header}.${payload}.AAAA`,
  ]) {
    const response = await app.request(
      "/api/demo/clients",
      { headers: authorization ? { Authorization: authorization } : {} },
      env,
    );
    expect(response.status).toBe(401);
  }
  expect(db).not.toHaveBeenCalled();
});
it("the production app rejects the browser fixture signing key before any database access", async () => {
  const jwt = await new SignJWT({
    sub: id,
    email: "invited@gmail.com",
    role: "authenticated",
    app_metadata: { providers: ["google"] },
    amr: [{ method: "oauth" }],
  })
    .setIssuer(issuer)
    .setAudience("authenticated")
    .setExpirationTime("1h")
    .setProtectedHeader({ alg: "HS256" })
    .sign(testSigningKey);
  const db = vi.fn<RunWithDb>();
  const response = await createApp({ withDb: db }).request(
    "/api/demo/clients",
    {
      headers: { Authorization: `Bearer ${jwt}` },
    },
    env,
  );
  expect(response.status).toBe(401);
  expect(db).not.toHaveBeenCalled();
});
it("refuses a deactivated/uninvited user on the next request with an existing valid JWT", async () => {
  vi.mocked(resolveUser).mockResolvedValue(null);
  const withDb: RunWithDb = (_env, run) => run({} as Db);
  const response = await createApp({ withDb }).request(
    "/api/demo/clients",
    { headers: { Authorization: `Bearer ${await token()}` } },
    env,
  );
  expect(response.status).toBe(403);
  expect((await response.json()).error.code).toBe("ACCOUNT_NOT_ALLOWED");
});
it("only Admin can call every user management operation", async () => {
  const db = vi.fn<RunWithDb>();
  for (const role of roleSchema.options.filter((r) => r !== "admin")) {
    const app = createApp({
      withDb: db as unknown as RunWithDb,
      resolveActor: async () => ({
        userId: id,
        role,
        employmentType: "full_time",
      }),
    });
    for (const [method, path] of [
      ["GET", "/api/admin/users"],
      ["POST", "/api/admin/users"],
      ...["resend", "revoke", "deactivate", "reactivate"].map((a) => [
        "POST",
        `/api/admin/users/${id}/${a}`,
      ]),
    ]) {
      expect((await app.request(path, { method }, env)).status).toBe(403);
    }
  }
  expect(db).not.toHaveBeenCalled();
});
it("allows only the supported lifecycle transitions", () => {
  expect(nextUserStatus("pending", "resend")).toBe("pending");
  expect(nextUserStatus("pending", "revoke")).toBe("revoked");
  expect(nextUserStatus("active", "deactivate")).toBe("deactivated");
  expect(nextUserStatus("deactivated", "reactivate")).toBe("active");
  for (const [status, action] of [
    ["active", "resend"],
    ["pending", "reactivate"],
    ["revoked", "reactivate"],
    ["deactivated", "revoke"],
  ] as const)
    expect(nextUserStatus(status, action)).toBeNull();
});
it("protects demo, dev, unknown and ordinary API routes without a token", async () => {
  for (const path of [
    "/api/demo/clients",
    "/api/dev/db-check",
    "/api/admin/users",
    "/api/auth/me",
    "/api/unknown",
    "/api/clients",
  ])
    expect((await createApp().request(path, {}, env)).status).toBe(401);
});
