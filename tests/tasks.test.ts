import { describe, expect, it } from "vitest";
import {
  dueBucket,
  offsetLabel,
  taskFilterSchema,
  taskTemplateInputSchema,
  taskViewInputSchema,
  templateDueAt,
} from "../shared/tasks";

// The pure rules behind the task dashboard (FLOW-61), saved views (FLOW-59) and
// task templates (FLOW-62). Times are New York business time.

describe("dueBucket", () => {
  // 10:00 EDT on Oct 29, 2026.
  const now = new Date("2026-10-29T14:00:00.000Z");
  it("sorts by business day, not UTC day", () => {
    expect(dueBucket("2026-10-29T13:00:00.000Z", now)).toBe("overdue");
    expect(dueBucket("2026-10-29T15:00:00.000Z", now)).toBe("today");
    // 11:59 PM New York is already the 30th in UTC: still today.
    expect(dueBucket("2026-10-30T03:59:00.000Z", now)).toBe("today");
    expect(dueBucket("2026-10-30T04:00:00.000Z", now)).toBe("upcoming");
    expect(dueBucket(null, now)).toBe("upcoming");
  });
});

describe("templateDueAt (FLOW-62 AC1)", () => {
  // Sept 17, 2026 at 6:00 PM EDT.
  const event = new Date("2026-09-17T22:00:00.000Z");
  it("uses the event's start time when the item has none", () => {
    expect(templateDueAt(event, { offsetDays: -14, time: null }).toISOString()).toBe(
      "2026-09-03T22:00:00.000Z",
    );
  });
  it("uses the item's own time", () => {
    expect(templateDueAt(event, { offsetDays: -1, time: "16:00" }).toISOString()).toBe(
      "2026-09-16T20:00:00.000Z",
    );
    expect(templateDueAt(event, { offsetDays: 2, time: "09:30" }).toISOString()).toBe(
      "2026-09-19T13:30:00.000Z",
    );
  });
  it("counts calendar days across a clock change", () => {
    // Nov 3, 2026 6:00 PM EST; three days before is Oct 31, still EDT.
    const after = new Date("2026-11-03T23:00:00.000Z");
    expect(templateDueAt(after, { offsetDays: -3, time: null }).toISOString()).toBe(
      "2026-10-31T22:00:00.000Z",
    );
  });
  it("moves a time skipped when clocks spring forward to the next hour", () => {
    // March 8, 2026: 2:30 AM doesn't happen in New York.
    const spring = new Date("2026-03-09T22:00:00.000Z");
    expect(templateDueAt(spring, { offsetDays: -1, time: "02:30" }).toISOString()).toBe(
      "2026-03-08T07:30:00.000Z",
    );
  });
});

describe("offsetLabel", () => {
  it("reads like the ticket's examples", () => {
    expect(offsetLabel({ offsetDays: -14, time: null })).toBe("T-14 days");
    expect(offsetLabel({ offsetDays: -1, time: "16:00" })).toBe("Day before 4:00 PM");
    expect(offsetLabel({ offsetDays: 0, time: "00:15" })).toBe("Event day 12:15 AM");
    expect(offsetLabel({ offsetDays: 3, time: "12:00" })).toBe("T+3 days 12:00 PM");
  });
});

describe("schemas", () => {
  it("accepts every list filter together and rejects unknown ones in a saved view", () => {
    expect(
      taskFilterSchema.parse({
        type: "kitchen",
        status: "todo",
        assigneeId: "c5900000-0000-4000-8000-000000000001",
        eventId: "c5900000-0000-4000-8000-000000000002",
        due: "today",
        mine: "true",
      }),
    ).toMatchObject({ type: "kitchen", due: "today" });
    expect(taskViewInputSchema.safeParse({ name: "Mine", filter: { colour: "red" } }).success).toBe(false);
    expect(taskViewInputSchema.safeParse({ name: " ", filter: {} }).success).toBe(false);
  });

  it("checks template links, times and items", () => {
    const item = { title: "Order balloons", offsetDays: -14 };
    expect(taskTemplateInputSchema.parse({ name: "Arch", items: [item] })).toMatchObject({
      sopUrl: null,
      items: [{ type: "production", time: null, position: null }],
    });
    for (const bad of [
      { name: "Arch", items: [] },
      { name: "Arch", sopUrl: "ftp://files.example/sop", items: [item] },
      { name: "Arch", items: [{ ...item, time: "4pm" }] },
      { name: "Arch", items: [{ ...item, offsetDays: 1.5 }] },
    ])
      expect(taskTemplateInputSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });
});
