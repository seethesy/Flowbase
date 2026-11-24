import { describe, expect, it, vi } from "vitest";
import { diffChildren, syncChildren } from "../worker/records/core/sync";

const values = (row: { name: string }, sortOrder: number) => ({ name: row.name, sortOrder });

describe("child row sync", () => {
  it("writes nothing for unchanged rows and rejects an id from another parent", async () => {
    const existing = [{ id: "one", name: "Alex", sortOrder: 0 }];
    const ops = { insert: vi.fn(async (rows: { input: { id?: string; name: string }; sortOrder: number }[]) => rows.length), update: vi.fn(async () => {}), archive: vi.fn(async () => {}) };
    expect(await syncChildren(existing, [{ id: "one", name: "Alex" }], values, ops))
      .toEqual({ insert: [], update: [], archive: [] });
    expect(ops.insert).not.toHaveBeenCalled();
    expect(ops.update).not.toHaveBeenCalled();
    expect(ops.archive).not.toHaveBeenCalled();
    expect(() => diffChildren(existing, [{ id: "foreign", name: "Pat" }], values)).toThrow();
  });

  it("inserts five new rows in one operation and archives removed rows once", async () => {
    const ops = { insert: vi.fn(async (rows: { input: { id?: string; name: string }; sortOrder: number }[]) => rows.length), update: vi.fn(async () => {}), archive: vi.fn(async () => {}) };
    await syncChildren([], Array.from({ length: 5 }, (_, index) => ({ id: undefined, name: `Contact ${index}` })), values, ops);
    expect(ops.insert).toHaveBeenCalledOnce();
    expect(ops.insert.mock.calls[0][0]).toHaveLength(5);
    await syncChildren([{ id: "one", name: "Alex", sortOrder: 0 }], [], values, ops);
    expect(ops.archive).toHaveBeenCalledOnce();
    expect(ops.archive).toHaveBeenCalledWith(["one"]);
  });
});
