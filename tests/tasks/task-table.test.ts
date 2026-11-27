import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrastRatio, MIN_CONTRAST } from "../../shared/contrast";
import { claimButton, taskRowState } from "../../shared/tasks";
import { pastEventPeriod } from "../../shared/core-records";

// 10 am in New York on Nov 27, 2026.
const now = new Date("2026-11-27T15:00:00.000Z");

describe("FLOW-345 task row colors", () => {
  it("marks done tasks green before anything else", () => {
    expect(taskRowState({ status: "done", dueAt: "2026-11-20T15:00:00.000Z" }, now)).toBe("done");
  });
  it("marks overdue and due-today open tasks", () => {
    expect(taskRowState({ status: "todo", dueAt: "2026-11-27T14:00:00.000Z" }, now)).toBe("overdue");
    expect(taskRowState({ status: "in_progress", dueAt: "2026-11-27T22:00:00.000Z" }, now)).toBe("today");
  });
  it("leaves later and undated tasks plain", () => {
    expect(taskRowState({ status: "todo", dueAt: "2026-11-29T15:00:00.000Z" }, now)).toBeNull();
    expect(taskRowState({ status: "todo", dueAt: null }, now)).toBeNull();
  });
  it("keeps the row text readable on every row color", () => {
    const css = readFileSync("src/styles/tokens.css", "utf8");
    const token = (name: string) => css.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "i"))?.[1];
    const text = token("text")!;
    for (const name of ["task-overdue-bg", "task-today-bg", "task-done-bg"])
      expect(contrastRatio(text, token(name)!)).toBeGreaterThanOrEqual(MIN_CONTRAST);
    expect(contrastRatio("#ffffff", token("task-drop-bg")!)).toBeGreaterThanOrEqual(MIN_CONTRAST);
  });
});

describe("FLOW-345/346 Pick up and Drop", () => {
  const open = { status: "todo" as const, assignees: [{ id: "u-1" }] };
  it("offers Drop to an assignee and Pick up to anyone else who may write", () => {
    expect(claimButton(open, "u-1", true)).toBe("drop");
    expect(claimButton(open, "u-2", true)).toBe("pick-up");
  });
  it("offers nothing on done tasks, to readers or when signed out", () => {
    expect(claimButton({ ...open, status: "done" }, "u-1", true)).toBeNull();
    expect(claimButton(open, "u-2", false)).toBeNull();
    expect(claimButton(open, null, true)).toBeNull();
  });
});

describe("FLOW-340 Past Events (A2)", () => {
  const today = "2026-11-27";
  it("calls an event before today Past once it reached Closed", () => {
    for (const status of ["closed", "preparation", "finished"] as const)
      expect(pastEventPeriod({ date: "2026-11-26", status }, today)).toBe("past");
  });
  it("calls an event before today Lost when it never reached Closed or was marked Lost", () => {
    for (const status of ["inquiry", "negotiation", "closing", "lost"] as const)
      expect(pastEventPeriod({ date: "2026-11-26", status }, today)).toBe("lost");
  });
  it("leaves today's and later events out", () => {
    expect(pastEventPeriod({ date: today, status: "closed" }, today)).toBeNull();
    expect(pastEventPeriod({ date: "2026-12-01", status: "lost" }, today)).toBeNull();
  });
});
