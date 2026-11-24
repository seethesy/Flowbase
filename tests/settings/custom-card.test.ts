import { describe, expect, it } from "vitest";
import { cardProblem } from "../../src/components/custom-card";
import { cardFields, cardRequestPath } from "../../src/services/layout";
import { builtinCard, cardConfigSchema, type CardConfig } from "../../shared/layout";
import type { Actor } from "../../shared/access";

// Data cards (FLOW-326): a card the builder makes resolves to a request and
// columns, and a card never renders blank.
const admin: Actor = { userId: "a0000000-0000-4000-8000-000000000001", role: "admin" };
const eventsTable = cardConfigSchema.parse({
  title: "Events",
  source: { type: "list", list: "events" },
  display: { type: "table", columns: [{ key: "title" }, { key: "status" }, { key: "date" }] },
});

describe("custom cards", () => {
  it("a Main list: Events table resolves to the events list with its fields, filters, sort and rows (AC1)", () => {
    const path = cardRequestPath(eventsTable, "events", null, null)!;
    const url = new URL(path, "https://x");
    expect(url.pathname).toBe("/api/events");
    expect(url.searchParams.get("fields")).toBe("title,status,date");
    expect(url.searchParams.get("take")).toBe("10");
    expect(cardProblem(eventsTable, "events", admin)).toBeNull();
  });

  it("Boxes with Event, Status and Date read those fields (AC2)", () => {
    const boxes = cardConfigSchema.parse({
      ...eventsTable,
      display: { type: "boxes", boxes: ["title", "status", "date"].map((field, i) => ({ id: `f${i}`, kind: "field", field, x: 0, y: i * 2, w: 6, h: 2 })) },
    });
    expect(cardFields(boxes)).toEqual(["title", "status", "date"]);
    expect(cardProblem(boxes, "events", admin)).toBeNull();
  });

  it("edited built-in cards keep their source and show the new fields (AC3)", () => {
    const upcoming = builtinCard("dashboard.home", "upcoming-events", {
      filters: [{ field: "date", op: "within_days", value: 30 }],
      sort: { field: "date", dir: "asc" },
      limit: 10,
      display: { type: "table", columns: [{ key: "title" }, { key: "status" }] },
    })!;
    const url = new URL(cardRequestPath(upcoming, "events", null, null)!, "https://x");
    expect(url.pathname).toBe("/api/events");
    expect(url.searchParams.get("fields")).toBe("title,status");
    expect(JSON.parse(url.searchParams.get("where")!)).toEqual([{ field: "date", op: "within_days", value: 30 }]);
    const leads = builtinCard("dashboard.home", "my-leads", {
      filters: [{ field: "assignedSalespersonId", op: "is_me" }],
      limit: 10,
      display: { type: "table", columns: [{ key: "name" }, { key: "guestCount" }] },
    })!;
    expect(new URL(cardRequestPath(leads, "leads", null, null)!, "https://x").pathname).toBe("/api/leads");
    expect(cardProblem(leads, "leads", admin)).toBeNull();
  });

  it("a related list reads that record's related rows (AC4)", () => {
    const related: CardConfig = { ...eventsTable, source: { type: "related", relation: "events" } };
    const path = cardRequestPath(related, "events", "c0000000-0000-4000-8000-000000000001", "/api/clients/c0000000-0000-4000-8000-000000000001/events");
    expect(path).toMatch(/^\/api\/clients\/c0000000-0000-4000-8000-000000000001\/events\?fields=title%2Cstatus%2Cdate/);
  });

  it("a card with no source on the page or no fields it can show says so instead of rendering blank", () => {
    expect(cardProblem(eventsTable, null, admin)).toBe("no-source");
    const unknown = { ...eventsTable, display: { type: "table" as const, columns: [{ key: "notAField" }] } };
    expect(cardProblem(unknown, "events", admin)).toBe("no-fields");
    expect(cardProblem(eventsTable, "events", null)).toBe("no-fields");
    // Text boxes alone still show.
    const text = cardConfigSchema.parse({ ...eventsTable, display: { type: "boxes", boxes: [{ id: "t", kind: "text", text: "Note", x: 0, y: 0, w: 6, h: 2 }] } });
    expect(cardProblem(text, "events", admin)).toBeNull();
  });
});
