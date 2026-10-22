// @vitest-environment node
import { expect, it } from "vitest";
import { createApp } from "../../worker/app";
import type { RunWithDb } from "../../worker/hono";
import type { Db } from "../../worker/db/client";
import type { Actor } from "../../shared/access";

const env = { ASSETS: { fetch } };
const admin: Actor = {
  userId: "8d6f2a4e-5b1c-4e8a-9f3d-2c7b1a0e6d54",
  role: "admin",
  employmentType: "full_time",
};
// Hands the route a database that must never be queried.
const untouchedDb = ((_env, run) => run({} as Db)) as RunWithDb;
const app = createApp({ withDb: untouchedDb, resolveActor: async () => admin });
const recordId = "8d6f2a4e-5b1c-4e8a-9f3d-2c7b1a0e6d54";
const start = (body: unknown) =>
  app.request(
    "/api/attachments",
    { method: "POST", body: JSON.stringify(body) },
    env,
  );
const photo = (size = 200_000) => ({
  recordType: "venue",
  recordId,
  fileName: "plan.jpg",
  variants: [
    { name: "thumb", contentType: "image/jpeg", size: 20_000 },
    { name: "display", contentType: "image/jpeg", size },
  ],
});

it("answers 401 without a signed-in user", async () => {
  const response = await createApp().request("/api/attachments", {}, env);
  expect(response.status).toBe(401);
});
it.each([
  ["an unsupported document type", {
    ...photo(),
    variants: [{ name: "original", contentType: "text/plain", size: 10 }],
  }],
  ["an unresized photo original", {
    ...photo(),
    variants: [{ name: "original", contentType: "image/jpeg", size: 10 }],
  }],
  ["an oversized resized photo", photo(6 * 1024 * 1024)],
  ["an oversized document", {
    ...photo(),
    variants: [
      { name: "original", contentType: "application/pdf", size: 21 * 1024 * 1024 },
    ],
  }],
  ["an unknown record type", { ...photo(), recordType: "invoice" }],
])("rejects %s before issuing upload URLs", async (_label, body) => {
  const response = await start(body);
  expect(response.status).toBe(400);
});
it("answers 503 when file storage isn't configured", async () => {
  const response = await start(photo());
  expect(response.status).toBe(503);
  expect((await response.json()).error.code).toBe("STORAGE_NOT_CONFIGURED");
});
