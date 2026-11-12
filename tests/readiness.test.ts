import { describe, expect, it } from "vitest";
import type { ReadinessFacts } from "../worker/readiness/types";
import { responsibility } from "../worker/readiness/responsibility";
import { schedule } from "../worker/readiness/schedule";
import { resource } from "../worker/readiness/resource";
import { quantity } from "../worker/readiness/quantity";
import { dataGaps } from "../worker/readiness/data-gaps";

const facts = (): ReadinessFacts => ({ eventTitle: "Autumn gala", guestCount: 120,
  tasks: [], pull: null, trucks: [], slots: [], dishes: [], proposalLines: [] });

describe("readiness rules", () => {
  it("asks who is building an unassigned balloon arch", () => {
    const input = facts();
    input.tasks.push({ id: "task-1", title: "Build balloon arch", assigneeIds: [] });
    expect(responsibility(input)[0].question).toBe("Who is building the balloon arch?");
    input.tasks[0].assigneeIds.push("person-1");
    expect(responsibility(input)).toEqual([]);
  });
  it("asks for an unscheduled pull time", () => {
    const input = facts();
    input.pull = { id: "pull-1", scheduledAt: null, lines: [] };
    expect(schedule(input)[0].question).toBe("What day and time are items being pulled from inventory?");
  });
  it("asks who loads a truck without loaders", () => {
    const input = facts();
    input.trucks.push({ id: "truck-1", name: "Truck A", loaderIds: [], conflictMessage: null });
    expect(responsibility(input)[0].question).toBe("Who is loading the truck going to the event?");
  });
  it("shows a real truck conflict message", () => {
    const input = facts();
    const message = "You are attempting to assign Truck A to Autumn gala at 3:00pm. Possible conflict: Truck A is already assigned to Winter lunch";
    input.trucks.push({ id: "truck-1", name: "Truck A", loaderIds: ["loader"], conflictMessage: message });
    expect(resource(input)[0].question).toBe(message);
  });
  it("compares pull quantity with guests using the catalog ratio", () => {
    const input = facts();
    input.pull = { id: "pull-1", scheduledAt: "2026-11-12T14:00:00.000Z", lines: [
      { id: "plates", name: "plates", quantity: 100, ratio: 1, basis: "per_guest" },
    ] };
    expect(quantity(input)[0].question).toBe("The Pull List says to pull 100 plates, but the guest count for the event is 120");
    input.pull.lines[0].quantity = 120;
    expect(quantity(input)).toEqual([]);
  });
  it("flags TBD quantities, unfilled slots, missing yields and unmatched proposal lines", () => {
    const input = facts();
    input.pull = { id: "pull-1", scheduledAt: null, lines: [{ id: "line-1", name: "cups", quantity: null, ratio: null, basis: null }] };
    input.slots.push({ id: "slot-1", position: "Server", assigneeId: null });
    input.dishes.push({ id: "dish-1", name: "Pasta", yieldServings: null });
    input.proposalLines.push({ id: "proposal-1", name: "Arch", kind: "decor", catalogId: null, notTracked: false });
    expect(dataGaps(input).map((row) => row.key)).toEqual(["tbd:line-1", "slot:slot-1", "yield:dish-1", "proposal:proposal-1"]);
  });
});
