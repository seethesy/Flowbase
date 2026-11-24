import { describe, expect, it } from "vitest";
import { eventFieldsOf, mayGenerateBeoFrom, proposalDate, proposalTime } from "../../shared/beo-from-proposal";
import { proposalMappingSchema } from "../../shared/proposal-mapping";

// FLOW-337: which stages offer Generate BEO, and reading the mapping's event fields.
describe("FLOW-337: Generate BEO from a proposal", () => {
  it("is offered at Closing and Closed only (AC2)", () => {
    expect(mayGenerateBeoFrom("closing")).toBe(true);
    expect(mayGenerateBeoFrom("closed")).toBe(true);
    for (const stage of ["inquiry", "pitching", "p_creation", "p_sent", "negotiation", "lost"] as const)
      expect(mayGenerateBeoFrom(stage)).toBe(false);
  });

  it("reads the proposal's dates and times", () => {
    expect(proposalDate("5/8/2027")).toBe("2027-05-08");
    expect(proposalDate("May 8th, 2027")).toBe("2027-05-08");
    expect(proposalDate("2027-05-08")).toBe("2027-05-08");
    expect(proposalDate("2/30/2027")).toBeNull();
    expect(proposalDate("next spring")).toBeNull();
    expect(proposalTime("6pm")).toBe("18:00");
    expect(proposalTime("6:30 PM")).toBe("18:30");
    expect(proposalTime("12 a.m.")).toBe("00:00");
    expect(proposalTime("18:45")).toBe("18:45");
    expect(proposalTime("13pm")).toBeNull();
  });

  it("keeps the event's own value for a field the mapping lacks or can't read", () => {
    const mapping = proposalMappingSchema.parse({
      versionId: "a0000000-0000-4000-8000-000000003371",
      fields: {
        eventDate: { value: "June 12, 2027", sourceBlockId: null },
        startTime: { value: "5pm", sourceBlockId: null },
        guestCount: { value: "about a hundred", sourceBlockId: null },
        address: { value: "  ", sourceBlockId: null },
      },
    });
    expect(eventFieldsOf(mapping)).toEqual({ date: "2027-06-12", startTime: "17:00", endTime: null, guestCount: null, address: null });
  });
});
