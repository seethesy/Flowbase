import { describe, expect, it } from "vitest";
import { filterSalesRows, salesCsv, salesFilterSchema, type SalesRow } from "../shared/sales";

const row = (patch: Partial<SalesRow>): SalesRow => ({
  id: "a0000000-0000-4000-8000-000000000001", kind: "proposal",
  clientId: "b0000000-0000-4000-8000-000000000001", client: "A, Inc.",
  eventId: "c0000000-0000-4000-8000-000000000001", title: "Dinner",
  eventDate: "2026-11-14", eventType: "Dinner", stage: "finalized",
  ownerId: "d0000000-0000-4000-8000-000000000001", owner: "Sam",
  source: "Referral", totalCents: 125000, receivedCents: 25000,
  balanceCents: 100000, lastActivity: "2026-11-11T12:00:00.000Z",
  nextFollowUp: null, bookedAt: null, eventStatus: "closed", leadStatus: null,
  proposalStage: "finalized", versionNumber: 1, ...patch,
});

describe("sales tracker filtering and export", () => {
  const rows = [row({}), row({ id: "a0000000-0000-4000-8000-000000000002", client: "Beta", stage: "lost", proposalStage: "lost", owner: "Sue", ownerId: "d0000000-0000-4000-8000-000000000002", totalCents: 50000 })];
  it("filters by owner, stage and search and sorts the visible rows", () => {
    expect(filterSalesRows(rows, salesFilterSchema.parse({ owner: rows[0].ownerId, stage: "finalized", search: "inc" }))).toEqual([rows[0]]);
    expect(filterSalesRows(rows, salesFilterSchema.parse({ sort: "total" })).map((item) => item.totalCents)).toEqual([125000, 50000]);
    expect(filterSalesRows([row({ eventStatus: "finished" })], salesFilterSchema.parse({}))).toEqual([]);
    expect(filterSalesRows([row({ eventStatus: "finished" })], salesFilterSchema.parse({ history: true }))).toHaveLength(1);
  });
  it("exports exactly the supplied rows with safe CSV quoting", () => {
    const csv = salesCsv([rows[0]]);
    expect(csv).toContain('"A, Inc."');
    expect(csv).toContain('"1250"');
    expect(csv).not.toContain("Beta");
  });
});
