import { describe, it, expect } from "vitest";
import {
  stockStatus,
  transitionContract,
  createRecordService,
} from "../src/services/records";
import {
  contracts,
  customers,
  contacts,
  inventory,
  suppliers,
  purchaseOrders,
  events,
  employees,
} from "../src/data/mock/fixtures";
describe("inventory availability", () => {
  it.each([
    { onHand: 20, reserved: 5, reorder: 10, status: "In Stock" },
    { onHand: 20, reserved: 10, reorder: 10, status: "Low Stock" },
    { onHand: 10, reserved: 10, reorder: 5, status: "Out of Stock" },
    { onHand: 4, reserved: 8, reorder: 5, status: "Out of Stock" },
  ])("calculates $status using available stock", ({ status, ...item }) =>
    expect(stockStatus(item)).toBe(status),
  );
});
describe("contract stage rules", () => {
  it("allows Draft to Sent and preserves the original record", () => {
    const draft = contracts[0];
    expect(transitionContract(draft, "Sent").stage).toBe("Sent");
    expect(draft.stage).toBe("Draft");
  });
  it("rejects Draft to Signed", () =>
    expect(() => transitionContract(contracts[0], "Signed")).toThrow(
      "Cannot move Draft to Signed",
    ));
  it("requires a nonblank loss reason", () => {
    expect(() => transitionContract(contracts[0], "Lost", " ")).toThrow(
      "loss reason",
    );
    expect(
      transitionContract(contracts[0], "Lost", "Budget reduced").lossReason,
    ).toBe("Budget reduced");
  });
  it("prevents changing a signed contract", () =>
    expect(() => transitionContract(contracts[3], "Draft")).toThrow(
      "Signed contracts are final",
    ));
  it("can reopen a lost contract as a draft", () =>
    expect(transitionContract(contracts[4], "Draft").stage).toBe("Draft"));
});
it("seeds the requested fixture counts", () =>
  expect([
    customers.length,
    contacts.length,
    contracts.length,
    inventory.length,
    suppliers.length,
    purchaseOrders.length,
    events.length,
    employees.length,
  ]).toEqual([35, 45, 40, 50, 15, 12, 10, 8]));
it("supports replaceable record service save and remove", () => {
  let rows = [customers[0]];
  const service = createRecordService(rows, (next) => {
    rows = next;
  });
  service.save({ ...customers[0], name: "Updated" });
  expect(rows[0].name).toBe("Updated");
  service.remove(customers[0].id);
  expect(rows).toHaveLength(0);
});
