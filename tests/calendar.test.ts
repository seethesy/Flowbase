// @vitest-environment node
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { toCalendarEntries } from "../src/features/calendar-entries";

// Basic calendar (FLOW-63).

// AC3: FullCalendar's free standard packages only (ADR-19). Premium plugins
// (resource views, timeline, scheduler, …) need a paid licence.
const free = new Set([
  "@fullcalendar/core",
  "@fullcalendar/react",
  "@fullcalendar/daygrid",
  "@fullcalendar/timegrid",
  "@fullcalendar/list",
  "@fullcalendar/interaction",
]);
it("uses no FullCalendar premium plugins (AC3)", () => {
  const manifest = JSON.parse(readFileSync("package.json", "utf8")) as Record<
    string,
    Record<string, string> | undefined
  >;
  const fullCalendar = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]
    .flatMap((group) => Object.keys(manifest[group] ?? {}))
    .filter((name) => name.startsWith("@fullcalendar/"));
  expect(fullCalendar.length).toBeGreaterThan(0);
  expect(fullCalendar.filter((name) => !free.has(name))).toEqual([]);
});

it("draws events by their New York wall-clock times and opens their pages", () => {
  const entries = toCalendarEntries({
    events: [
      {
        id: "e0000000-0000-4000-8000-000000000001",
        title: "Fall gala",
        status: "closed",
        start: "2026-09-17T17:00",
        end: "2026-09-17T22:00",
        clientName: "Juniper & Co.",
        venueName: null,
      },
    ],
    tasks: [
      {
        id: "d0000000-0000-4000-8000-000000000001",
        title: "Polish the chafing dishes",
        status: "todo",
        priority: "high",
        due: "2026-09-16T10:00",
        eventId: null,
      },
    ],
  });
  expect(entries).toEqual([
    expect.objectContaining({
      title: "Fall gala · Closed",
      start: "2026-09-17T17:00",
      end: "2026-09-17T22:00",
      extendedProps: { path: "/events/e0000000-0000-4000-8000-000000000001" },
    }),
    expect.objectContaining({
      title: "Task: Polish the chafing dishes",
      start: "2026-09-16T10:00",
      extendedProps: { path: "/tasks/d0000000-0000-4000-8000-000000000001" },
    }),
  ]);
});
