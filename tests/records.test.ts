import { describe, it, expect } from "vitest";
import { stockStatus, transitionProposal } from "../src/services/records";
import {
  proposals,
  clients,
  inventory,
  vendors,
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
describe("proposal stage rules", () => {
  it("allows Draft to Sent and preserves the original record", () => {
    const draft = proposals[0];
    expect(transitionProposal(draft, "Sent").stage).toBe("Sent");
    expect(draft.stage).toBe("Draft");
  });
  it("rejects Draft to Signed", () =>
    expect(() => transitionProposal(proposals[0], "Signed")).toThrow(
      "Cannot move Draft to Signed",
    ));
  it("requires a nonblank loss reason", () => {
    expect(() => transitionProposal(proposals[0], "Lost", " ")).toThrow(
      "loss reason",
    );
    expect(
      transitionProposal(proposals[0], "Lost", "Budget reduced").lossReason,
    ).toBe("Budget reduced");
  });
  it("prevents changing a signed proposal", () =>
    expect(() => transitionProposal(proposals[3], "Draft")).toThrow(
      "Signed proposals are final",
    ));
  it("can reopen a lost proposal as a draft", () =>
    expect(transitionProposal(proposals[4], "Draft").stage).toBe("Draft"));
});
it("seeds the requested fixture counts", () =>
  expect([
    clients.length,
    proposals.length,
    inventory.length,
    vendors.length,
    events.length,
    employees.length,
  ]).toEqual([35, 40, 50, 15, 10, 8]));
