import {
  googleCalendarStatusSchema,
  googleConnectSchema,
  googleEventsSchema,
} from "../../shared/google-calendar";
import { query, request } from "./core";

// The signed-in person's own Google Calendar (FLOW-268).
export const googleCalendarApi = {
  status: () => request(googleCalendarStatusSchema, "/api/google-calendar"),
  // Answers Google's consent page; the browser goes there and comes back to the calendar.
  connect: () => request(googleConnectSchema, "/api/google-calendar/connect", "POST"),
  disconnect: () => request(googleCalendarStatusSchema, "/api/google-calendar", "DELETE"),
  events: (from: string, to: string) =>
    request(googleEventsSchema, `/api/google-calendar/events${query({ from, to })}`),
};
