import type { ProposalMapping } from "./proposal-mapping";
import type { ProposalStage } from "./proposals";

// Generate BEO from a proposal (FLOW-337): offered once the proposal is at
// Closing or Closed.
export const beoFromProposalStages: readonly ProposalStage[] = ["closing", "closed"];
export const mayGenerateBeoFrom = (stage: ProposalStage) => beoFromProposalStages.includes(stage);

const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const pad = (value: number) => String(value).padStart(2, "0");

// "5/8/2027", "May 8th, 2027" or "2027-05-08" as a date; anything else is null.
export function proposalDate(value: string): string | null {
  const text = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  const words = /^([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i.exec(text);
  const [year, month, day] = iso
    ? [Number(iso[1]), Number(iso[2]), Number(iso[3])]
    : slash
      ? [Number(slash[3]), Number(slash[1]), Number(slash[2])]
      : words
        ? [Number(words[3]), months.indexOf(words[1].toLowerCase()) + 1, Number(words[2])]
        : [0, 0, 0];
  if (!year || month < 1 || month > 12 || day < 1) return null;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCMonth() !== month - 1) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

// "6pm", "6:30 PM" or "18:30" as a 24-hour time; anything else is null.
export function proposalTime(value: string): string | null {
  const text = value.trim().toLowerCase().replace(/\./g, "");
  const twelve = /^(\d{1,2})(?::([0-5]\d))?\s*([ap])m?$/.exec(text);
  if (twelve) {
    const hour = Number(twelve[1]);
    if (hour < 1 || hour > 12) return null;
    return `${pad((hour % 12) + (twelve[3] === "p" ? 12 : 0))}:${twelve[2] ?? "00"}`;
  }
  const clock = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(text);
  return clock ? `${pad(Number(clock[1]))}:${clock[2]}` : null;
}

// The event fields a confirmed mapping sets, as event values. A field the mapping
// lacks or that can't be read is left out, so the event keeps its own value.
export function eventFieldsOf(mapping: ProposalMapping) {
  const field = (key: string) => mapping.fields[key]?.value.trim() ?? "";
  const guests = /^\d{1,6}$/.test(field("guestCount")) ? Number(field("guestCount")) : null;
  return {
    date: proposalDate(field("eventDate")),
    startTime: proposalTime(field("startTime")),
    endTime: proposalTime(field("endTime")),
    guestCount: guests,
    address: field("address") || null,
  };
}
