// @vitest-environment node
import { expect, it, vi } from "vitest";
import { createApp } from "../../worker/app";
import { postgresErrorCode } from "../../worker/db/errors";
import type { RunWithDb } from "../../worker/hono";

const env = { ASSETS: { fetch } };
// What postgres.js throws: the server's fields, including severity and the
// SQLSTATE, copied onto an Error. Drizzle wraps it as the cause.
const postgresError = (code: string) =>
  Object.assign(new Error("server error"), { code, severity: "ERROR" });
const wrapped = (code: string) =>
  new Error("Failed query: insert into ...", { cause: postgresError(code) });

const request = async (error: Error) => {
  const withDb = vi.fn<RunWithDb>().mockRejectedValue(error) as unknown as RunWithDb;
  const app = createApp({
    withDb,
    resolveActor: async () => ({
      userId: "8d6f2a4e-5b1c-4e8a-9f3d-2c7b1a0e6d54",
      role: "admin",
      employmentType: "full_time",
    }),
  });
  const response = await app.request("/api/inventory/items", {}, env);
  return { status: response.status, body: (await response.json()) as { error: { code: string } } };
};

it("finds the SQLSTATE on a Postgres error and through wrapping causes (FLOW-187)", () => {
  expect(postgresErrorCode(postgresError("23505"))).toBe("23505");
  expect(postgresErrorCode(wrapped("23514"))).toBe("23514");
  expect(postgresErrorCode(new Error("plain"))).toBeUndefined();
  expect(postgresErrorCode(Object.assign(new Error("node"), { code: "ECONNREFUSED" }))).toBeUndefined();
  expect(postgresErrorCode("23505")).toBeUndefined();
});

it("answers a unique violation with 409 ALREADY_EXISTS", async () => {
  expect(await request(wrapped("23505"))).toMatchObject({
    status: 409,
    body: { error: { code: "ALREADY_EXISTS" } },
  });
});

it("answers a CHECK violation with 400 INVALID_VALUE", async () => {
  expect(await request(wrapped("23514"))).toMatchObject({
    status: 400,
    body: { error: { code: "INVALID_VALUE" } },
  });
});

it("still answers other database errors with 500", async () => {
  expect(await request(wrapped("40001"))).toMatchObject({
    status: 500,
    body: { error: { code: "INTERNAL_ERROR" } },
  });
});
