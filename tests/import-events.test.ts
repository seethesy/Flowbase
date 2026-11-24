import { describe, expect, it } from "vitest";
import {
  describeEventRow,
  eventExternalKey,
  eventImportFields,
  parseEventRow,
  parseImportDate,
  parseImportTime,
  type EventImportRow,
} from "../shared/import-events";
import { autoMap, headingIndex, mapRows } from "../shared/imports";
import { parseCsv } from "../src/services/import-files";
import { eventsCsv } from "./fixtures/events-sheet";

// The Events importer's row parsing (FLOW-299), run the way the Imports screen
// runs it, on a synthetic sheet (ADR-27).
const sheet = parseCsv(eventsCsv);
const rows = mapRows(sheet, autoMap(sheet[headingIndex(sheet)], eventImportFields));
const parsed = new Map(rows.map((row) => [row.rowNumber, parseEventRow(row.values)]));
const at = (rowNumber: number): EventImportRow => {
  const result = parsed.get(rowNumber);
  if (!result || !("row" in result)) throw new Error(`Row ${rowNumber} didn't parse.`);
  return result.row;
};

describe("Events importer (FLOW-299)", () => {
  it("maps every column of the sheet automatically", () => {
    expect(Object.values(autoMap(sheet[0], eventImportFields)).every((index) => index !== null)).toBe(true);
  });

  it("reads each row's event, date, time, status, client, contact and guests", () => {
    expect(at(2)).toMatchObject({
      title: "Sample Spring Social",
      date: "2027-04-10",
      startTime: "18:30",
      status: "pitching",
      clientName: "Sample Person One",
      contactName: "Sample Person One",
      guestCount: 80,
      venue: "Sample Hall",
      notes: "Wants a taco bar",
      review: [],
    });
    expect(at(3)).toMatchObject({ date: "2027-05-22", startTime: "18:00", status: "closing", clientName: "Sample Org", guestCount: 1200 });
    expect(at(4)).toMatchObject({ status: "closed", startTime: "12:00", clientName: "Sample Person Three", contactName: "", review: ["No start time; set to 12:00 PM."] });
    expect(at(5)).toMatchObject({ status: "lost", startTime: "11:00" });
    expect(at(6).status).toBe("inquiry");
  });

  it("Q1: says whether a row creates the client (Closing or later)", () => {
    expect(describeEventRow(at(2)).summary).toContain("lead and event");
    expect(describeEventRow(at(3)).summary).toContain("lead, event and client");
    expect(describeEventRow(at(4)).summary).toContain("lead, event and client");
    expect(describeEventRow(at(4)).notes).toEqual(["No start time; set to 12:00 PM."]);
  });

  it("reports what is wrong with a row", () => {
    expect(parsed.get(7)).toEqual({
      errors: [
        "Date is required.",
        'Status "Maybe" isn\'t one of Inquiry, Pitching, P Creation, P Sent, Negotiation, Closing, Closed, Lost.',
      ],
    });
    expect(parseEventRow({ event: "X", date: "2027-01-01" })).toEqual({ errors: ["Client or Contact is required."] });
    expect(parseEventRow({ event: "X", date: "2027-01-01", contact: "A", guests: "lots", email: "nope" })).toEqual({
      errors: ['Email "nope" isn\'t an email address.', 'Guests "lots" isn\'t a whole number.'],
    });
  });

  it("AC2: keys a row by client, date and event name, ignoring case and spacing", () => {
    expect(eventExternalKey(at(3))).toBe("event:sample org|2027-05-22|sample gala");
    expect(eventExternalKey({ ...at(3), clientName: "SAMPLE  org", title: "Sample  GALA" })).toBe(eventExternalKey(at(3)));
  });

  it("reads dates and times as typed or as spreadsheet serials", () => {
    expect(parseImportDate("2027-02-28")).toBe("2027-02-28");
    expect(parseImportDate("2/3/27")).toBe("2027-02-03");
    expect(parseImportDate("46388")).toBe("2027-01-01");
    expect(parseImportDate("2027-02-30")).toBeNull();
    expect(parseImportTime("6pm")).toBe("18:00");
    expect(parseImportTime("12:15 am")).toBe("00:15");
    expect(parseImportTime("0.75")).toBe("18:00");
    expect(parseImportTime("13 pm")).toBeNull();
    expect(parseImportTime("soon")).toBeNull();
  });
});
