import { describe, expect, it } from "vitest";
import { pipelineStatuses } from "../../shared/pipeline";
import { leadsHeadingDefaultStatuses, leadsHeadingStatuses, salesHeadingStatuses } from "../../shared/leads";

// FLOW-351: Leads › Overview keeps a lead whatever its status; Sales › Overview
// keeps only the late stages (FLOW-328).
describe("heading status sets", () => {
  it("Leads › Overview's filter offers every pipeline status", () => {
    expect([...leadsHeadingStatuses]).toEqual([...pipelineStatuses]);
  });
  it("Leads › Overview lists every status but Lost while the filter is empty (A1)", () => {
    expect([...leadsHeadingDefaultStatuses]).toEqual(["inquiry", "pitching", "p_creation", "p_sent", "negotiation", "closing", "closed"]);
  });
  it("Sales › Overview still lists only Negotiation, Closing and Closed", () => {
    expect([...salesHeadingStatuses]).toEqual(["negotiation", "closing", "closed"]);
  });
});
