import type { ImportField } from "./imports";
import { pipelineLabels, pipelineStatuses, type PipelineStatus } from "./pipeline";
import { isLocalDate } from "./schema-primitives";

// Row parsing for the Events importer (FLOW-299). Pure, so the browser, the
// Worker and the tests share one implementation. Flowbase is public (ADR-27):
// nothing here or in the tests holds a row of the real sheet.
//
// Assumption: no sanitized sample of the events sheet exists yet, so the
// columns below are a working layout (one row per event) that column mapping can
// fit to the real sheet; revisit them when the sample lands in Flowbase-Data.
// Q1 (developer, 2026-11-24, pending Art's confirmation): each row becomes a
// lead at the row's status plus its event, and a client once the status is
// Closing or later.

export const eventImportFields: ImportField[] = [
  { key: "event", label: "Event", required: true, aliases: ["Event Name", "Title"] },
  { key: "date", label: "Date", required: true, aliases: ["Event Date"] },
  { key: "start_time", label: "Start Time", required: false, aliases: ["Time", "Start"] },
  { key: "status", label: "Status", required: false, aliases: ["Stage"] },
  { key: "client", label: "Client", required: false, aliases: ["Client Name", "Company"] },
  { key: "contact", label: "Contact", required: false, aliases: ["Contact Name", "Name"] },
  { key: "email", label: "Email", required: false, aliases: ["Contact Email"] },
  { key: "phone", label: "Phone", required: false, aliases: ["Contact Phone"] },
  { key: "guests", label: "Guests", required: false, aliases: ["Guest Count", "Headcount"] },
  { key: "venue", label: "Venue", required: false, aliases: ["Location", "Address"] },
  { key: "event_type", label: "Event Type", required: false, aliases: ["Type"] },
  { key: "notes", label: "Notes", required: false, aliases: [] },
];

export type EventImportRow = {
  title: string;
  date: string;
  startTime: string;
  status: PipelineStatus;
  // The client's name: the Client column, else the contact's name.
  clientName: string;
  contactName: string;
  email: string;
  phone: string;
  guestCount: number | null;
  venue: string;
  eventType: string;
  notes: string;
  // Things the dry run lists for review.
  review: string[];
};

const clean = (value: string | undefined) => (value ?? "").trim();
const key = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();
const pad = (value: number) => String(value).padStart(2, "0");

// Statuses at which Closing has created the client.
const clientStatuses: readonly PipelineStatus[] = ["closing", "closed"];
export const createsClient = (status: PipelineStatus) => clientStatuses.includes(status);

const statusByName = new Map<string, PipelineStatus>(
  pipelineStatuses.flatMap((status) => [
    [key(pipelineLabels[status]), status],
    [key(status.replace("_", " ")), status],
  ]),
);

// 2026-06-13, 6/13/2026 (US order) or a spreadsheet date serial (an .xlsx date
// cell, days since 1899-12-30).
export function parseImportDate(text: string): string | null {
  if (isLocalDate(text)) return text;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(text);
  if (us) {
    const year = us[3].length === 2 ? 2000 + Number(us[3]) : Number(us[3]);
    const date = `${year}-${pad(Number(us[1]))}-${pad(Number(us[2]))}`;
    return isLocalDate(date) ? date : null;
  }
  if (/^\d{5}(\.\d+)?$/.test(text)) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(text)) * 86_400_000);
    return date.toISOString().slice(0, 10);
  }
  return null;
}

// 18:30, 6:30 PM, 6pm or a spreadsheet time fraction (0.770833…).
export function parseImportTime(text: string): string | null {
  const clock = /^(\d{1,2})(?::(\d{2}))?\s*([ap])?\.?\s*m?\.?$/i.exec(text);
  if (clock && (clock[2] !== undefined || clock[3])) {
    let hour = Number(clock[1]);
    const minute = Number(clock[2] ?? 0);
    const half = clock[3]?.toLowerCase();
    if (half && (hour < 1 || hour > 12)) return null;
    if (half === "p" && hour !== 12) hour += 12;
    if (half === "a" && hour === 12) hour = 0;
    return hour < 24 && minute < 60 ? `${pad(hour)}:${pad(minute)}` : null;
  }
  if (/^0?\.\d+$/.test(text)) {
    const minutes = Math.round(Number(text) * 24 * 60);
    return minutes < 24 * 60 ? `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}` : null;
  }
  return null;
}

// Rows with no start time start at noon, flagged for review.
const defaultStartTime = "12:00";

export function parseEventRow(
  values: Record<string, string>,
): { row: EventImportRow } | { errors: string[] } {
  const errors: string[] = [];
  const review: string[] = [];
  const title = clean(values.event);
  if (!title) errors.push("Event is required.");

  const dateText = clean(values.date);
  const date = dateText ? parseImportDate(dateText) : null;
  if (!dateText) errors.push("Date is required.");
  else if (!date) errors.push(`Date "${dateText}" isn't a date.`);

  const timeText = clean(values.start_time);
  let startTime = defaultStartTime;
  if (!timeText) review.push("No start time; set to 12:00 PM.");
  else {
    const parsed = parseImportTime(timeText);
    if (parsed) startTime = parsed;
    else errors.push(`Start Time "${timeText}" isn't a time.`);
  }

  const statusText = clean(values.status);
  const status = statusText ? statusByName.get(key(statusText)) : "inquiry";
  if (!status)
    errors.push(
      `Status "${statusText}" isn't one of ${pipelineStatuses.map((value) => pipelineLabels[value]).join(", ")}.`,
    );

  const contactName = clean(values.contact);
  const clientName = clean(values.client) || contactName;
  if (!clientName) errors.push("Client or Contact is required.");

  const email = clean(values.email);
  if (email && !/^\S+@\S+\.\S+$/.test(email)) errors.push(`Email "${email}" isn't an email address.`);

  const guestText = clean(values.guests).replace(/,/g, "");
  let guestCount: number | null = null;
  if (guestText) {
    if (/^\d+$/.test(guestText) && Number(guestText) <= 100_000) guestCount = Number(guestText);
    else errors.push(`Guests "${clean(values.guests)}" isn't a whole number.`);
  }

  if (errors.length || !date || !status) return { errors };
  return {
    row: {
      title: title.slice(0, 200),
      date,
      startTime,
      status,
      clientName: clientName.slice(0, 200),
      contactName: contactName.slice(0, 200),
      email,
      phone: clean(values.phone).slice(0, 40),
      guestCount,
      venue: clean(values.venue).slice(0, 500),
      eventType: clean(values.event_type).slice(0, 100),
      notes: clean(values.notes).slice(0, 5000),
      review,
    },
  };
}

// The same event is the same client, date and event name.
export const eventExternalKey = (row: EventImportRow) =>
  `event:${key(row.clientName)}|${row.date}|${key(row.title)}`.slice(0, 200);

export function describeEventRow(row: EventImportRow) {
  const creates = createsClient(row.status) ? "lead, event and client" : "lead and event";
  return {
    summary: `${row.title} · ${row.date} ${row.startTime} · ${pipelineLabels[row.status]} · ${row.clientName}${row.guestCount === null ? "" : ` · ${row.guestCount} guests`} · ${creates}`,
    notes: row.review,
  };
}
