import { z } from "zod";
import { localDate } from "./schema-primitives";

// Per-user Google Calendar sync (FLOW-268). Each person may connect their own
// Google account: their own Google events show on the Flowbase calendar for
// them alone (never stored, never shown to anyone else), and every Flowbase
// event they may see is copied into a "Flowbase events" calendar the app creates
// in their account. Their own calendars are never edited.

// The secondary calendar Flowbase creates and keeps in step.
export const FLOWBASE_CALENDAR_NAME = "Flowbase events";

// The narrowest scopes that allow reading the user's events and managing one
// calendar the app created.
export const googleCalendarScopes = [
  "https://www.googleapis.com/auth/calendar.events.readonly",
  "https://www.googleapis.com/auth/calendar.app.created",
] as const;

// How often the sweep re-checks every connected user (AC2: within 15 minutes).
export const GOOGLE_SYNC_MINUTES = 15;
// Overlay responses are cached per user and range for this long.
export const GOOGLE_OVERLAY_CACHE_MS = 5 * 60_000;

export const googleCalendarStatusSchema = z.object({
  // False until the Google OAuth client and the token key are set as Worker secrets.
  configured: z.boolean(),
  connected: z.boolean(),
  // The sign-in stopped working (revoked, expired): the user should reconnect.
  needsReconnect: z.boolean(),
  lastSyncedAt: z.iso.datetime().nullable(),
});
export type GoogleCalendarStatus = z.infer<typeof googleCalendarStatusSchema>;

export const googleConnectSchema = z.object({ url: z.url() });

const wallClock = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
// One of the user's own Google events, in New York wall-clock time like the
// rest of the calendar. All-day events carry dates, with an exclusive end.
export const googleEventSchema = z.object({
  id: z.string(),
  title: z.string(),
  start: z.union([wallClock, localDate]),
  end: z.union([wallClock, localDate]).nullable(),
  allDay: z.boolean(),
  // Opens the event in Google Calendar.
  htmlLink: z.url().nullable(),
});
export type GoogleEvent = z.infer<typeof googleEventSchema>;
export const googleEventsSchema = z.object({ events: z.array(googleEventSchema) });
export type GoogleEvents = z.infer<typeof googleEventsSchema>;
