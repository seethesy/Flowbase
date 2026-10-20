import { beforeEach, expect, it, vi } from "vitest";
const sql = vi.hoisted(() => Object.assign(vi.fn(), { end: vi.fn() }));
vi.mock("postgres", () => ({ default: vi.fn(() => sql) }));
import { checkDatabase } from "../../worker/health";

beforeEach(() => {
  sql.mockReset();
  sql.end.mockReset().mockResolvedValue(undefined);
});
it("reports a missing binding honestly", async () => {
  expect(await checkDatabase({ ASSETS: { fetch } })).toBe("not_configured");
  expect(sql).not.toHaveBeenCalled();
});
it.each([true, false])(
  "probes select 1 and closes the client (reachable=%s)",
  async (reachable) => {
    if (reachable) sql.mockResolvedValue([{ "?column?": 1 }]);
    else sql.mockRejectedValue(new Error("not reachable"));
    expect(
      await checkDatabase({
        ASSETS: { fetch },
        HYPERDRIVE: { connectionString: "postgres://ci" },
      }),
    ).toBe(reachable ? "reachable" : "unreachable");
    expect(sql.end).toHaveBeenCalledWith({ timeout: 1 });
  },
);
