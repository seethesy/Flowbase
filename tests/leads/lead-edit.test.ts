import { describe, expect, it } from "vitest";
import { leadUpdateSchema, type Lead } from "../../shared/leads";
import { leadChanges, leadDraft } from "../../src/features/leads/lead-detail";

// FLOW-334: the lead page's Edit mode sends only what changed, as the update
// API takes it; the API takes every editable field and refuses calculated ones.
const lead: Lead = {
  id: "b0000000-0000-4000-8000-000000000001",
  receivedAt: "2026-10-20T14:30:00.000Z",
  channel: "webhook",
  source: "Bark",
  sourceLeadId: "bark-1001",
  sourceLeadUrl: "https://bark.example/leads/1001",
  purchased: true,
  name: "Maya Ortiz",
  email: "maya@example.com",
  phone: "(202) 555-0142",
  eventDate: "2026-11-14",
  guestCount: 80,
  location: "Brooklyn, NY",
  eventType: "Wedding",
  budgetCents: 1_200_000,
  message: "Plated dinner for 80.",
  status: "lost",
  eventName: "Ortiz wedding",
  latestEvent: { id: "e0000000-0000-4000-8000-000000000001", title: "Ortiz wedding", startsAt: "2026-11-14T22:00:00.000Z" },
  notes: null,
  lostReason: "Went elsewhere",
  firstRespondedAt: null,
  firstResponseSeconds: null,
  assignedSalespersonId: null,
  convertedClientId: null,
  convertedEventId: null,
  needsReview: false,
  mergedIntoLeadId: null,
  archivedAt: null,
  createdAt: "2026-10-20T14:30:00.000Z",
  updatedAt: "2026-10-20T14:30:00.000Z",
};

describe("lead page Edit mode (FLOW-334)", () => {
  it("starts from the stored values, times in New York", () => {
    expect(leadDraft(lead)).toMatchObject({
      received: "2026-10-20T10:30",
      eventTime: "17:00",
      budget: "12000",
      guestCount: "80",
      channel: "webhook",
      lostReason: "Went elsewhere",
    });
  });

  it("sends nothing when nothing changed", () => {
    expect(leadChanges(leadDraft(lead), leadDraft(lead))).toEqual({});
  });

  it("sends each changed field in the API's shape, and the API accepts them", () => {
    const before = leadDraft(lead);
    const after = {
      ...before,
      name: " Maya O. ",
      eventType: "Rehearsal dinner",
      location: "Queens, NY",
      budget: "15000.50",
      guestCount: "",
      message: "Buffet now.",
      source: "Referral",
      channel: "manual" as const,
      received: "2026-10-19T09:00",
      sourceLeadId: "bark-2002",
      sourceLeadUrl: "https://bark.example/leads/2002",
      eventTime: "18:30",
      eventDate: "",
      lostReason: "Budget",
    };
    const changes = leadChanges(before, after);
    expect(changes).toEqual({
      name: "Maya O.",
      eventType: "Rehearsal dinner",
      location: "Queens, NY",
      budgetCents: 1_500_050,
      guestCount: null,
      message: "Buffet now.",
      source: "Referral",
      channel: "manual",
      receivedAt: "2026-10-19T13:00:00.000Z",
      sourceLeadId: "bark-2002",
      sourceLeadUrl: "https://bark.example/leads/2002",
      eventTime: "18:30",
      eventDate: null,
      lostReason: "Budget",
    });
    expect(leadUpdateSchema.safeParse(changes).success).toBe(true);
  });

  it("leaves the lost reason to the status move when the lead isn't lost yet", () => {
    const open = { ...lead, status: "pitching" as const, lostReason: "" };
    const after = { ...leadDraft(open), status: "lost" as const, lostReason: "Budget" };
    expect(leadChanges(leadDraft(open), after)).toEqual({});
  });

  it("refuses calculated values and unknown fields (AC2)", () => {
    for (const calculated of [{ firstResponseSeconds: 60 }, { firstRespondedAt: lead.receivedAt }, { needsReview: true }, { latestEvent: null }, { status: "pitching" }])
      expect(leadUpdateSchema.safeParse(calculated).success).toBe(false);
    expect(leadUpdateSchema.safeParse({ sourceLeadUrl: "not a link" }).success).toBe(false);
    expect(leadUpdateSchema.safeParse({ sourceLeadUrl: "" }).success).toBe(true);
    expect(leadUpdateSchema.safeParse({ source: " " }).success).toBe(false);
  });
});
