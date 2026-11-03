// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { overviewLine, toCalendarEntries } from "../src/features/calendar-entries";
import { calendarSchema, type Calendar, type CalendarLayer } from "../shared/calendar";

// Basic calendar (FLOW-63), overview mode (FLOW-64) and layers (FLOW-67).

const noLayers = { production: [], holds: [], shifts: [] };
const galaId = "e0000000-0000-4000-8000-000000000001";
const gala = {
  id: galaId,
  title: "Fall gala",
  status: "closed" as const,
  start: "2026-09-17T17:00",
  end: "2026-09-17T22:00",
  clientName: "Juniper & Co.",
  venueName: null,
  guestCount: 120,
  salespersonName: "Sam",
  staffCount: 6,
};

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
    events: [gala],
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
    layers: noLayers,
  });
  expect(entries).toEqual([
    expect.objectContaining({
      title: "Fall gala · Closed",
      start: "2026-09-17T17:00",
      end: "2026-09-17T22:00",
      extendedProps: expect.objectContaining({
        path: "/events/e0000000-0000-4000-8000-000000000001",
      }),
    }),
    expect.objectContaining({
      title: "Task: Polish the chafing dishes",
      start: "2026-09-16T10:00",
      extendedProps: { path: "/tasks/d0000000-0000-4000-8000-000000000001" },
    }),
  ]);
});

describe("overview mode (FLOW-64)", () => {
  it("shows the venue, guest count, salesperson and staff count on every event (AC1)", () => {
    expect(overviewLine({ ...gala, venueName: "The Atrium" })).toBe(
      "The Atrium · 120 guests · Sam · 6 staff",
    );
    // Missing values still show, so every entry has every field.
    expect(
      overviewLine({ ...gala, guestCount: null, salespersonName: null, staffCount: 1 }),
    ).toBe("No venue · Guests TBD · No salesperson · 1 staff");
    expect(overviewLine({ ...gala, guestCount: 1 })).toContain("1 guest ·");
    const [entry] = toCalendarEntries({ events: [gala], tasks: [], layers: noLayers });
    expect(entry).toMatchObject({
      title: "Fall gala · Closed",
      display: "block",
      extendedProps: { overview: "No venue · 120 guests · Sam · 6 staff" },
    });
  });

  it("sends no contact details or pricing with an event", () => {
    const keys = Object.keys(calendarSchema.shape.events.element.shape).sort();
    expect(keys).toEqual(
      [
        "clientName",
        "end",
        "guestCount",
        "id",
        "salespersonName",
        "staffCount",
        "start",
        "status",
        "title",
        "venueName",
      ].sort(),
    );
  });
});

describe("calendar layers (FLOW-67)", () => {
  const taskId = "d0000000-0000-4000-8000-000000000001";
  const calendar: Calendar = {
    events: [gala],
    tasks: [],
    layers: {
      production: [
        {
          id: taskId,
          title: "Prep crudités",
          status: "todo",
          priority: "normal",
          due: "2026-09-17T09:00",
          eventId: galaId,
        },
      ],
      holds: [
        {
          eventId: galaId,
          eventTitle: "Fall gala",
          start: "2026-09-16",
          end: "2026-09-18",
          items: 2,
          quantity: 130,
        },
      ],
      shifts: [
        {
          id: "f0000000-0000-4000-8000-000000000001",
          eventId: galaId,
          eventTitle: "Fall gala",
          kind: "setup",
          start: "2026-09-16T14:00",
          end: "2026-09-16T18:00",
          slots: 4,
          staffed: 3,
        },
      ],
    },
  };
  const on = (...layers: CalendarLayer[]) => new Set(layers);
  const ids = (layers: Set<CalendarLayer>) =>
    toCalendarEntries(calendar, layers).map((entry) => entry.id);

  it("shows only the layers that are on (AC1)", () => {
    expect(ids(on())).toEqual([`event:${galaId}`]);
    expect(ids(on("production"))).toEqual([`event:${galaId}`, `production:${taskId}`]);
    expect(ids(on("holds", "shifts"))).toEqual([
      `event:${galaId}`,
      `hold:${galaId}:2026-09-16:2026-09-18`,
      "shift:f0000000-0000-4000-8000-000000000001",
    ]);
  });

  it("puts a day-before setup shift on its own date, at New York times (AC2)", () => {
    const shift = toCalendarEntries(calendar, on("shifts")).at(-1);
    expect(shift).toMatchObject({
      title: "Setup day: Fall gala · 3/4 staffed",
      start: "2026-09-16T14:00",
      end: "2026-09-16T18:00",
      extendedProps: { path: `/events/${galaId}` },
    });
  });

  it("draws a hold over its whole window, inclusive of the last day", () => {
    expect(toCalendarEntries(calendar, on("holds")).at(-1)).toMatchObject({
      title: "Tentative hold: Fall gala · 2 items",
      start: "2026-09-16",
      end: "2026-09-19",
      allDay: true,
    });
  });

  it("doesn't repeat a production task the viewer already sees as their own", () => {
    const own = { ...calendar, tasks: calendar.layers.production };
    expect(
      toCalendarEntries(own, on("production")).map((entry) => entry.id),
    ).toEqual([`event:${galaId}`, `task:${taskId}`]);
  });
});
