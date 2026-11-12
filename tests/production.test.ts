import { describe, expect, it } from "vitest";
import { completion, type ProductionItem } from "../shared/production";

const item = (id: string, complete: boolean): ProductionItem => ({
  id, eventId: "e0000000-0000-4000-8000-000000000001", eventTitle: "Autumn gala",
  type: "task", title: id, due: "2026-11-14T14:00:00.000Z", complete,
  team: "Production", assignedUserIds: [],
});

describe("production completion", () => {
  it("updates the percentage when a production task is completed", () => {
    const items = [item("arch", false), item("load", true)];
    expect(completion(items)).toEqual({ total: 2, complete: 1, percent: 50 });
    items[0].complete = true;
    expect(completion(items)).toEqual({ total: 2, complete: 2, percent: 100 });
  });
});
