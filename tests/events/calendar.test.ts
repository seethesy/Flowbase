// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { calendarRange, calendarWhen, toCalendarEntries } from "../../src/features/events/calendar-entries";
import {
  calendarGroupStatuses,
  calendarSchema,
  calendarStatusGroup,
  calendarStatusGroupLabels,
  calendarStatusGroups,
  type Calendar,
  type CalendarLayer,
} from "../../shared/calendar";

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
  salespersonId: null,
  leadId: null,
  proposal: null,
  beoId: null,
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
      title: "Fall gala",
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

describe("event chips and the side panel (FLOW-265)", () => {
  it("draws each event as a status-colored chip and reads its date and time", () => {
    const [entry] = toCalendarEntries({ events: [gala], tasks: [], layers: noLayers });
    expect(entry).toMatchObject({
      title: "Fall gala",
      display: "block",
      // Closed is confirmed: a filled chip (FLOW-294).
      classNames: ["calendar-event", "calendar-status-closed", "calendar-group-confirmed", "calendar-confirmed"],
      extendedProps: { eventId: galaId, status: "closed", group: "confirmed", pending: false },
    });
    expect(calendarWhen(gala)).toBe("Thu, Sep 17 · 5:00 PM");
    expect(calendarWhen({ start: "2026-11-28T00:05" })).toBe("Sat, Nov 28 · 12:05 AM");
    expect(calendarWhen({ start: "2026-11-28T12:30" })).toBe("Sat, Nov 28 · 12:30 PM");
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
        "salespersonId",
        "leadId",
        "proposal",
        "beoId",
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

// FLOW-348: the events table under the calendar lists the days the calendar
// shows. A month view shows six weeks, so its table does too.
describe("the range the calendar and its events table show (FLOW-348)", () => {
  it("lists the month grid's trailing days in a month view (AC1)", () => {
    const range = calendarRange("month", "2026-11-15");
    // November 2026 starts on a Sunday; the grid runs six weeks to Dec 12.
    expect(range.fetch).toEqual({ from: "2026-11-01", to: "2026-12-12" });
    expect(range.table).toEqual(range.fetch);
    expect(range.table.from <= "2026-12-11" && "2026-12-11" <= range.table.to).toBe(true);
  });

  it("leaves out days outside the six visible weeks (AC2)", () => {
    const range = calendarRange("month", "2026-11-15");
    expect("2026-12-13" > range.table.to).toBe(true);
    expect("2026-10-31" < range.table.from).toBe(true);
    // A month that starts mid-week takes the grid's leading days too.
    expect(calendarRange("month", "2026-12-01").table).toEqual({ from: "2026-11-29", to: "2027-01-09" });
  });

  it("keeps Week and Day views as they were (AC3)", () => {
    expect(calendarRange("week", "2026-11-18").table).toEqual({ from: "2026-11-15", to: "2026-11-21" });
    expect(calendarRange("day", "2026-11-18").table).toEqual({ from: "2026-11-18", to: "2026-11-18" });
  });
});

// FLOW-354: the calendar's four statuses group the pipeline statuses it shows.
describe("calendar statuses (FLOW-354)", () => {
  it("are Pending, Confirmed, Preparation and Done, in that order (AC1)", () => {
    expect(calendarStatusGroups.map((group) => calendarStatusGroupLabels[group])).toEqual([
      "Pending", "Confirmed", "Preparation", "Done",
    ]);
  });

  it("groups Negotiation and Closing as Pending and Finished as Done (AC2, AC4)", () => {
    expect(calendarStatusGroup("negotiation")).toBe("pending");
    expect(calendarStatusGroup("closing")).toBe("pending");
    expect(calendarStatusGroup("closed")).toBe("confirmed");
    expect(calendarStatusGroup("preparation")).toBe("preparation");
    expect(calendarStatusGroup("finished")).toBe("done");
    expect(calendarStatusGroup("lost")).toBeNull();
  });

  it("filters Pending by both of its pipeline statuses (AC3)", () => {
    expect(calendarGroupStatuses.pending).toEqual(["negotiation", "closing"]);
    expect(Object.values(calendarGroupStatuses).flat().sort()).toEqual(
      ["closed", "closing", "finished", "negotiation", "preparation"],
    );
  });

  it("draws Negotiation and Closing chips alike as pending, and Finished as Done", () => {
    const at = (status: Calendar["events"][number]["status"]) =>
      toCalendarEntries({ events: [{ ...gala, status }], tasks: [], layers: noLayers })[0];
    for (const status of ["negotiation", "closing"] as const)
      expect(at(status).classNames).toEqual(expect.arrayContaining(["calendar-group-pending", "calendar-pending"]));
    expect(at("finished").classNames).toEqual(expect.arrayContaining(["calendar-group-done", "calendar-confirmed"]));
  });
});
