import { beforeEach, expect, it, vi } from "vitest";
import { createApp } from "../../worker/app";
import type { Db } from "../../worker/db/client";
import type { RunWithDb } from "../../worker/hono";
import { changeUser, inviteUser, listUsers } from "../../worker/records/users";

const sendInvite = vi.hoisted(() => vi.fn());
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: { admin: { inviteUserByEmail: sendInvite } } }),
}));
vi.mock("../../worker/records/users", async (original) => ({
  ...(await original<typeof import("../../worker/records/users")>()),
  inviteUser: vi.fn(),
  changeUser: vi.fn(),
  listUsers: vi.fn(),
}));
const id = "37000000-0000-4000-8000-000000000001";
const actor = {
  userId: id,
  role: "admin",
  employmentType: "full_time",
} as const;
const user = {
  id,
  name: "invited@gmail.com",
  email: "invited@gmail.com",
  role: "staff",
  employmentType: "part_time",
  mobile: "2025550101",
  status: "pending",
  invitedAt: new Date().toISOString(),
  activatedAt: null,
} as const;
const env = {
  ASSETS: { fetch },
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_SECRET_KEY: "server-only",
  APP_URL: "https://app.example",
};
const withDb: RunWithDb = (_env, run) => run({} as Db);
const app = createApp({ withDb, resolveActor: async () => actor });
const input = {
  email: user.email,
  role: user.role,
  employmentType: user.employmentType,
  mobile: user.mobile,
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(inviteUser).mockResolvedValue(user);
  vi.mocked(changeUser).mockResolvedValue(user);
  vi.mocked(listUsers).mockResolvedValue([user]);
  sendInvite.mockResolvedValue({ data: {}, error: null });
});
it("Admin creates a pending invitation and sends it through Supabase with the configured redirect", async () => {
  const response = await app.request(
    "/api/admin/users",
    {
      method: "POST",
      body: JSON.stringify({ ...input, email: "INVITED@gmail.com" }),
    },
    env,
  );
  expect(response.status).toBe(201);
  expect(inviteUser).toHaveBeenCalledWith(expect.anything(), actor, input);
  expect(sendInvite).toHaveBeenCalledWith(user.email, {
    redirectTo: env.APP_URL,
  });
  expect((await app.request("/api/admin/users", {}, env)).status).toBe(200);
});
it("rejects invalid invitations and unconfigured delivery before writing the allowlist", async () => {
  for (const body of [
    "{",
    JSON.stringify({ ...input, mobile: "" }),
    JSON.stringify({ ...input, role: "owner" }),
  ])
    expect(
      (await app.request("/api/admin/users", { method: "POST", body }, env))
        .status,
    ).toBe(400);
  expect(
    (
      await app.request(
        "/api/admin/users",
        { method: "POST", body: JSON.stringify(input) },
        { ASSETS: { fetch } },
      )
    ).status,
  ).toBe(503);
  expect(inviteUser).not.toHaveBeenCalled();
  expect(sendInvite).not.toHaveBeenCalled();
});
it("keeps a failed invitation retryable and resends only a pending invitation", async () => {
  sendInvite.mockResolvedValueOnce({
    error: { message: "private provider detail" },
  });
  const response = await app.request(
    "/api/admin/users",
    { method: "POST", body: JSON.stringify(input) },
    env,
  );
  expect(response.status).toBe(502);
  const body = await response.json();
  expect(body.error.code).toBe("INVITE_DELIVERY_FAILED");
  expect(body.error.message).toContain("Resend");
  expect(JSON.stringify(body)).not.toContain("private provider");
  expect(
    (
      await app.request(
        `/api/admin/users/${id}/resend`,
        { method: "POST" },
        env,
      )
    ).status,
  ).toBe(200);
  expect(changeUser).toHaveBeenCalledWith(
    expect.anything(),
    actor,
    id,
    "resend",
  );
  expect(sendInvite).toHaveBeenCalledTimes(2);
});
it("revocation and deactivation need no mail credentials and don't send email", async () => {
  for (const action of ["revoke", "deactivate", "reactivate"])
    expect(
      (
        await app.request(
          `/api/admin/users/${id}/${action}`,
          { method: "POST" },
          { ASSETS: { fetch } },
        )
      ).status,
    ).toBe(200);
  expect(sendInvite).not.toHaveBeenCalled();
});
