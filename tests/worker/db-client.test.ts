import { beforeEach, expect, it, vi } from "vitest";
const sql = vi.hoisted(() => Object.assign(vi.fn(), { end: vi.fn() }));
const postgres = vi.hoisted(() => vi.fn());
vi.mock("postgres", () => ({ default: postgres }));
vi.mock("drizzle-orm/postgres-js", () => ({
  drizzle: vi.fn((client: unknown) => ({ client })),
}));
import { drizzle } from "drizzle-orm/postgres-js";
import { withDb } from "../../worker/db/client";
import { DatabaseNotConfiguredError } from "../../worker/db/errors";

const env = { HYPERDRIVE: { connectionString: "postgres://hyperdrive" } };
beforeEach(() => {
  postgres.mockReset().mockReturnValue(sql);
  sql.end.mockReset().mockResolvedValue(undefined);
  vi.mocked(drizzle).mockClear();
});
it("refuses to run without the Hyperdrive binding", async () => {
  const run = vi.fn();
  await expect(withDb({}, run)).rejects.toBeInstanceOf(
    DatabaseNotConfiguredError,
  );
  expect(postgres).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
});
it("opens a request-local client from the binding and closes it afterwards", async () => {
  const result = await withDb(env, async (db) => ({ db }));
  expect(postgres).toHaveBeenCalledTimes(1);
  const [url, options] = postgres.mock.calls[0];
  expect(url).toBe("postgres://hyperdrive");
  expect(options).toMatchObject({ max: 5, fetch_types: false });
  // Prepared statements must stay enabled for Hyperdrive.
  expect(options.prepare).not.toBe(false);
  expect(drizzle).toHaveBeenCalledWith(
    sql,
    expect.objectContaining({ schema: expect.any(Object) }),
  );
  expect(result.db).toEqual({ client: sql });
  expect(sql.end).toHaveBeenCalledWith({ timeout: 1 });
});
it("closes the client when the callback fails", async () => {
  await expect(
    withDb(env, async () => {
      throw new Error("query failed");
    }),
  ).rejects.toThrow("query failed");
  expect(sql.end).toHaveBeenCalledWith({ timeout: 1 });
});
