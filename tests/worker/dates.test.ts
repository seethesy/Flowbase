// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { eventInputSchema } from "../../shared/core-records";
import { leadConvertSchema, leadIntakeSchema } from "../../shared/leads";
import { email, id, isLocalDate, localDate, timestamp } from "../../shared/schema-primitives";
import {
  addLocalDays,
  businessTimeToUtc,
  isBusinessTime,
  utcToBusinessTime,
} from "../../shared/time";

// Shared Zod primitives (FLOW-191) and New York calendar arithmetic (FLOW-200).
const message = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.error?.issues[0]?.message;

describe("schema primitives", () => {
  it.each(["2026-02-28", "2028-02-29", "2026-12-31", "2026-03-08"])("accepts %s", (value) =>
    expect(localDate.safeParse(value).success).toBe(true),
  );
  it.each(["2026-02-31", "2026-02-29", "2026-04-31", "2026-13-01", "2026-00-10", "2026-1-5", "soon", ""])(
    "rejects %s with the existing message",
    (value) => {
      expect(isLocalDate(value)).toBe(false);
      const result = localDate.safeParse(value);
      expect(result.success).toBe(false);
      expect(message(result)).toBe("Enter a date.");
      expect(result.error?.issues).toHaveLength(1);
    },
  );
  it("keeps the id, timestamp and email rules", () => {
    expect(id.safeParse("8d6f2a4e-5b1c-4e8a-9f3d-2c7b1a0e6d54").success).toBe(true);
    expect(id.safeParse("x").success).toBe(false);
    expect(timestamp.safeParse("2026-11-14T23:00:00.000Z").success).toBe(true);
    expect(timestamp.safeParse("2026-11-14").success).toBe(false);
    expect(email.safeParse("").success).toBe(true);
    expect(email.parse("  olivia@juniper.example ")).toBe("olivia@juniper.example");
    expect(message(email.safeParse("olivia"))).toBe("Enter a valid email address.");
  });
  it("rejects 2026-02-31 on events and leads alike", () => {
    const event = eventInputSchema.safeParse({
      title: "Fall gala",
      date: "2026-02-31",
      startTime: "18:00",
      clientId: "8d6f2a4e-5b1c-4e8a-9f3d-2c7b1a0e6d54",
    });
    expect(message(event)).toBe("Enter a date.");
    expect(
      leadIntakeSchema.safeParse({ channel: "manual", source: "x", eventDate: "2026-02-31" })
        .success,
    ).toBe(false);
    expect(
      leadConvertSchema.safeParse({ event: { date: "2026-02-31", startTime: "18:00" } }).success,
    ).toBe(false);
  });
  it("is the only place that defines the id, timestamp, localDate and email rules", () => {
    const files = ["shared", "worker"].flatMap((dir) =>
      readdirSync(dir, { recursive: true, encoding: "utf8" })
        .filter((file) => file.endsWith(".ts"))
        .map((file) => join(dir, file)),
    );
    const own =
      /const (id|uuid|idSchema|timestamp|localDate|email|optionalEmail|datePattern) = (z\b|text\(|\/)/;
    const offenders = files.filter(
      (file) => file !== join("shared", "schema-primitives.ts") && own.test(readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});

describe("New York calendar arithmetic", () => {
  it.each([
    ["2026-03-07", 1, "2026-03-08"],
    ["2026-03-08", 1, "2026-03-09"],
    ["2026-11-01", 1, "2026-11-02"],
    ["2026-12-31", 1, "2027-01-01"],
    ["2026-03-01", -1, "2026-02-28"],
    ["2026-11-14", -29, "2026-10-16"],
  ])("%s plus %i days is %s", (date, days, expected) =>
    expect(addLocalDays(date, days)).toBe(expected),
  );

  it.each([
    // Ordinary dates are unchanged (AC4).
    ["2026-07-04", "18:00", "2026-07-04T22:00:00.000Z"],
    ["2026-12-31", "23:30", "2027-01-01T04:30:00.000Z"],
    // Midnight on both transition days, and the day after.
    ["2026-03-08", "00:00", "2026-03-08T05:00:00.000Z"],
    ["2026-03-09", "00:00", "2026-03-09T04:00:00.000Z"],
    ["2026-11-01", "00:00", "2026-11-01T04:00:00.000Z"],
    ["2026-11-02", "00:00", "2026-11-02T05:00:00.000Z"],
    // Spring forward: either side of the skipped hour.
    ["2026-03-08", "01:59", "2026-03-08T06:59:00.000Z"],
    ["2026-03-08", "03:00", "2026-03-08T07:00:00.000Z"],
    ["2026-03-08", "03:30", "2026-03-08T07:30:00.000Z"],
    // Fall back: the repeated hour takes its first (EDT) occurrence, as before.
    ["2026-11-01", "00:59", "2026-11-01T04:59:00.000Z"],
    ["2026-11-01", "01:00", "2026-11-01T05:00:00.000Z"],
    ["2026-11-01", "01:30", "2026-11-01T05:30:00.000Z"],
    ["2026-11-01", "01:59", "2026-11-01T05:59:00.000Z"],
    ["2026-11-01", "02:00", "2026-11-01T07:00:00.000Z"],
  ])("%s %s in New York is %s", (date, time, utc) => {
    expect(isBusinessTime(date, time)).toBe(true);
    expect(businessTimeToUtc(date, time).toISOString()).toBe(utc);
    expect(utcToBusinessTime(new Date(utc))).toEqual({ date, time });
  });

  it.each([
    ["2026-03-08", "02:00"],
    ["2026-03-08", "02:30"],
    ["2026-03-08", "02:59"],
    ["2026-02-31", "18:00"],
  ])("refuses %s %s instead of moving it to another hour", (date, time) => {
    expect(isBusinessTime(date, time)).toBe(false);
    expect(() => businessTimeToUtc(date, time)).toThrow(RangeError);
  });

  it("makes the transition days 23 and 25 hours long", () => {
    const length = (date: string) =>
      (businessTimeToUtc(addLocalDays(date, 1), "00:00").getTime() -
        businessTimeToUtc(date, "00:00").getTime()) /
      3_600_000;
    expect(length("2026-03-08")).toBe(23);
    expect(length("2026-11-01")).toBe(25);
    expect(length("2026-07-04")).toBe(24);
  });
});
