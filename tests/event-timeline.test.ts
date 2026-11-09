import { describe, expect, it } from "vitest";
import {
  groupTimeline,
  parseTimelineLine,
  timelineEntryInputSchema,
  timelineWhoLabel,
} from "../shared/event-timeline";

// The event timeline's pure rules (FLOW-126): days in date order with entries in
// start order (AC1), the outside-vendor "who" (AC2), and reading a proposal line.

const entry = (id: string, date: string, startsAt: string) => ({
  id,
  date,
  startsAt,
});

describe("groupTimeline", () => {
  it("shows two days in date order with entries in start order (AC1)", () => {
    const days = groupTimeline(
      [
        entry("c", "2026-11-14", "2026-11-14T21:00:00.000Z"),
        entry("a", "2026-11-13", "2026-11-13T14:00:00.000Z"),
        entry("b", "2026-11-14", "2026-11-14T15:00:00.000Z"),
      ],
      [],
      "2026-11-14",
    );
    expect(days.map((day) => day.date)).toEqual(["2026-11-13", "2026-11-14"]);
    expect(days[0].entries.map((e) => e.id)).toEqual(["a"]);
    expect(days[1].entries.map((e) => e.id)).toEqual(["b", "c"]);
    expect(days.map((day) => day.isEventDay)).toEqual([false, true]);
  });

  it("always includes the event's own day, and the days only shifts fall on", () => {
    const days = groupTimeline(
      [],
      [{ date: "2026-11-12", startsAt: "2026-11-12T13:00:00.000Z" }],
      "2026-11-14",
    );
    expect(days.map((day) => day.date)).toEqual(["2026-11-12", "2026-11-14"]);
    expect(days[1].entries).toEqual([]);
  });

  it("breaks a tie on the same start by id so the order is stable", () => {
    const days = groupTimeline(
      [
        entry("b", "2026-11-14", "2026-11-14T15:00:00.000Z"),
        entry("a", "2026-11-14", "2026-11-14T15:00:00.000Z"),
      ],
      [],
      "2026-11-14",
    );
    expect(days[0].entries.map((e) => e.id)).toEqual(["a", "b"]);
  });
});

describe("timelineEntryInputSchema", () => {
  const base = {
    kind: "event",
    date: "2026-11-14",
    startTime: "16:00",
    endTime: "17:30",
    activity: "Guest arrival",
  };
  const vendorId = "11111111-1111-4111-8111-111111111111";

  it("accepts an outside vendor as who, with no user (AC2)", () => {
    const parsed = timelineEntryInputSchema.parse({
      ...base,
      who: { type: "vendor", vendorId },
    });
    expect(parsed.who).toEqual({ type: "vendor", vendorId });
  });

  it("defaults who to nobody and where to empty", () => {
    const parsed = timelineEntryInputSchema.parse(base);
    expect(parsed.who).toBeNull();
    expect(parsed.where).toBe("");
    expect(parsed.source).toBeNull();
  });

  it("requires an activity and a known kind", () => {
    expect(timelineEntryInputSchema.safeParse({ ...base, activity: "" }).success).toBe(false);
    expect(timelineEntryInputSchema.safeParse({ ...base, kind: "setup" }).success).toBe(false);
  });

  it("labels who by name, or by the role itself", () => {
    expect(timelineWhoLabel(null)).toBe("");
    expect(timelineWhoLabel({ type: "role", label: "Servers" })).toBe("Servers");
    expect(timelineWhoLabel({ type: "vendor", id: vendorId, name: "DJ Nova" })).toBe("DJ Nova");
  });
});

describe("parseTimelineLine", () => {
  it("reads a time range", () => {
    expect(parseTimelineLine("4:00 pm - 5:30 pm Guest arrival")).toEqual({
      startTime: "16:00",
      endTime: "17:30",
      activity: "Guest arrival",
    });
  });

  it("reads a single time", () => {
    expect(parseTimelineLine("12 pm: Pull rentals")).toEqual({
      startTime: "12:00",
      endTime: null,
      activity: "Pull rentals",
    });
    expect(parseTimelineLine("12 am Teardown").startTime).toBe("00:00");
  });

  it("leaves a line with no time as all activity", () => {
    expect(parseTimelineLine("Cocktail hour")).toEqual({
      startTime: null,
      endTime: null,
      activity: "Cocktail hour",
    });
  });
});
