import type { LeadIntake } from "../../shared/leads";

// Thumbtack lead webhooks (FLOW-108, ADR-13). Thumbtack's self-serve webhooks send
// lead (negotiation) events such as NegotiationCreatedV4 with the lead as its API
// returns it (developers.thumbtack.com, "Leads: Lead events and payloads"):
// negotiationID, status, category, customer (displayName, location, and contact
// details when shared), details (question/answer pairs) and createTime. The exact
// envelope wasn't documented, so the lead is looked for at the top level and under
// data / negotiation / payload. A real payload captured in FLOW-115 replaces the
// hand-made test fixture. Fields the payload doesn't carry are left empty, which
// puts the lead in "needs review".
type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown) =>
  typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";

const leadOf = (json: unknown): Json | undefined => {
  if (!isObject(json)) return undefined;
  for (const candidate of [json, json.data, json.negotiation, json.payload])
    if (isObject(candidate) && text(candidate.negotiationID)) return candidate;
  if (isObject(json.data) && isObject(json.data.negotiation))
    return leadOf(json.data.negotiation) ?? undefined;
  return undefined;
};

const eventOf = (json: unknown) => {
  if (!isObject(json)) return { type: "", id: "" };
  const event = isObject(json.event) ? json.event : json;
  return {
    type: text(event.eventType) || text(event.type) || text(json.eventType),
    id: text(event.eventID) || text(event.eventId) || text(json.eventID),
  };
};

// "Thumbtack lead ID + event": a redelivered event repeats it; each new event (a
// status update) is a new receipt.
export function thumbtackRecordId(json: unknown) {
  const lead = leadOf(json);
  if (!lead) return undefined;
  const event = eventOf(json);
  return `${text(lead.negotiationID)}:${event.id || event.type || text(lead.status) || "event"}`;
}

const answers = (lead: Json) =>
  (Array.isArray(lead.details) ? lead.details : [])
    .filter(isObject)
    .map((detail) => ({ question: text(detail.question), answer: text(detail.answer) }))
    .filter((detail) => detail.question && detail.answer);

const answerFor = (lead: Json, pattern: RegExp) =>
  answers(lead).find((detail) => pattern.test(detail.question))?.answer ?? "";

const months = [
  "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
];
const pad = (value: number) => String(value).padStart(2, "0");
const validDate = (year: number, month: number, day: number) => {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? `${year}-${pad(month)}-${pad(day)}`
    : null;
};
// 2026-11-14, 11/14/2026, or November 14, 2026 (also "Sat, Nov 14, 2026").
export function parseEventDate(value: string): string | null {
  let match = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(value);
  if (match) return validDate(Number(match[1]), Number(match[2]), Number(match[3]));
  match = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(value);
  if (match) return validDate(Number(match[3]), Number(match[1]), Number(match[2]));
  match = /([a-z]{3,9})\.? (\d{1,2}),? (\d{4})/i.exec(value);
  const month = match ? months.indexOf(match[1].slice(0, 3).toLowerCase()) : -1;
  return match && month >= 0 ? validDate(Number(match[3]), month + 1, Number(match[2])) : null;
}

// The first whole number in an answer ("About 80 guests", "50-75" → 50).
const firstNumber = (value: string) => {
  const match = /\d[\d,]*/.exec(value);
  return match ? Number(match[0].replace(/,/g, "")) : null;
};

const contact = (customer: Json, keys: string[]) => {
  for (const key of keys) {
    const value = text(customer[key]);
    if (value) return value;
  }
  return "";
};

// The lead fields for createLead, from a Thumbtack lead event.
export function thumbtackLead(json: unknown): LeadIntake | undefined {
  const lead = leadOf(json);
  if (!lead) return undefined;
  const customer = isObject(lead.customer) ? lead.customer : {};
  const location = isObject(customer.location) ? customer.location : {};
  const category = isObject(lead.category) ? lead.category : {};
  const place = [text(location.city), text(location.state)].filter(Boolean).join(", ");
  const guests = firstNumber(answerFor(lead, /guest|people|attendee|headcount/i));
  const budget = firstNumber(answerFor(lead, /budget|price range|spend/i));
  const email = contact(customer, ["email", "emailAddress"]);
  const createTime = text(lead.createTime);
  return {
    channel: "webhook",
    source: "Thumbtack",
    sourceLeadId: text(lead.negotiationID),
    name: contact(customer, ["displayName", "name", "fullName"]).slice(0, 200),
    email: /^\S+@\S+\.\S+$/.test(email) ? email.slice(0, 254) : "",
    phone: contact(customer, ["phone", "phoneNumber", "phone_number"]).slice(0, 40),
    eventDate: parseEventDate(answerFor(lead, /date|when/i)),
    guestCount: guests !== null && guests <= 100_000 ? guests : null,
    location: [place, text(location.zipCode)].filter(Boolean).join(" ").slice(0, 500),
    eventType: text(category.name).slice(0, 100),
    budgetCents: budget !== null && budget <= 10_000_000 ? budget * 100 : null,
    message: answers(lead)
      .map((detail) => `${detail.question}: ${detail.answer}`)
      .join("\n")
      .slice(0, 10_000),
    ...(createTime && !Number.isNaN(Date.parse(createTime))
      ? { receivedAt: new Date(createTime).toISOString() }
      : {}),
    rawPayload: json,
  };
}
