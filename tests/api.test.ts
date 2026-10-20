import { describe, it, expect, vi } from "vitest";
import { createRecordService } from "../src/services/records";
import { customerSchema, contractSchema, itemSchema } from "../shared/records";
import { customers, contracts, inventory } from "../src/data/mock/fixtures";

describe("shared record schemas", () => {
  it("parses every fixture using the API and app contract", () => {
    expect(customerSchema.array().parse(customers)).toEqual(customers);
    expect(contractSchema.array().parse(contracts)).toEqual(contracts);
    expect(itemSchema.array().parse(inventory)).toEqual(inventory);
  });
  it("rejects invalid stages, quantities and records", () => {
    expect(contractSchema.safeParse({ ...contracts[0], stage: "Approved" }).success).toBe(false);
    expect(itemSchema.safeParse({ ...inventory[0], onHand: -1 }).success).toBe(false);
    expect(customerSchema.safeParse({ id: "only-an-id" }).success).toBe(false);
  });
});
describe("async API record adapter", () => {
  it("loads, inserts, replaces, gets and removes without losing earlier changes", async () => {
    const service = createRecordService("customers", customerSchema);
    expect(await service.list()).toHaveLength(35);
    await service.save({ ...customers[0], name: "Updated" });
    const added = { ...customers[0], id: "new-id", name: "New client" };
    await service.save(added);
    expect((await service.get(customers[0].id))?.name).toBe("Updated");
    expect(await service.get(added.id)).toEqual(added);
    await service.remove(added.id);
    expect(await service.get(added.id)).toBeUndefined();
    expect(await service.list()).toHaveLength(35);
  });
  it("preserves the working set when the API rejects a write", async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(customers))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    const service = createRecordService("customers", customerSchema, request);
    await expect(service.save({ ...customers[0], name: "Rejected" })).rejects.toThrow("503");
    expect((await service.get(customers[0].id))?.name).toBe(customers[0].name);
  });
  it("rejects a response that disagrees with the shared schema", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json([{ id: "broken" }]));
    await expect(createRecordService("customers", customerSchema, request).list()).rejects.toThrow();
  });
});
