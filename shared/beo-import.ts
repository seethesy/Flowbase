import { z } from "zod";
import { id, localDate, text } from "./schema-primitives";
import { localTime } from "./core-records";
import { runOfShowRowInputSchema } from "./beo";
import { proposalDate, proposalTime } from "./beo-from-proposal";

// Import a BEO written in the company's Word BEO template (FLOW-338). The file is
// read in the browser into blocks (paragraphs, list items, table rows), and
// extractBeo sorts them into the template's sections. Q1 (A, then matching
// later): everything stays on the BEO. The schedule becomes the run of show;
// the summary, menu, drinks and staff go to the BEO's notes; the setup and decor
// list to its setup details; anything else, recognized as a further section or
// not, is kept in the notes too, so nothing is lost.

export type BeoImportBlock = { id: string; kind: "heading" | "paragraph" | "table"; text: string; rows?: string[][] };

export const beoImportSummaryKeys = [
  "title", "client", "date", "address", "guests", "eventType", "components", "transportation",
] as const;
export type BeoImportSummaryKey = (typeof beoImportSummaryKeys)[number];
export const beoImportSummaryLabels: Record<BeoImportSummaryKey, string> = {
  title: "Event title",
  client: "Client",
  date: "Date",
  address: "Address",
  guests: "# of guests",
  eventType: "Event type",
  components: "Components",
  transportation: "Transportation",
};

export type BeoImportScheduleRow = { time: string; cue: string; notes: string; source: string };
export type BeoImportSection = { heading: string; lines: string[] };
export type BeoImportDraft = {
  summary: Partial<Record<BeoImportSummaryKey, string>>;
  // "Set up 2:00pm–3:00pm" and the like, from Duration.
  durations: string[];
  menu: string[];
  drinks: string[];
  staff: string[];
  schedule: BeoImportScheduleRow[];
  setup: string[];
  // Further sections of the file (Layout, Inventory lists…), kept as text.
  other: BeoImportSection[];
  // Text that fits no section, and schedule lines without a readable time.
  unrecognized: string[];
};

type Section = "summary" | "duration" | "menu" | "drinks" | "staff" | "schedule" | "setup" | "other" | "none";

const clean = (value: string) => value.replace(/\s+/g, " ").trim();
const heading = (value: string): { section: Section; title: string } | null => {
  const title = clean(value);
  const plain = title.replace(/[^a-z ]/gi, " ").replace(/\s+/g, " ").trim().toLowerCase();
  if (/^event summary$/.test(plain)) return { section: "summary", title };
  if (/^menu$/.test(plain)) return { section: "menu", title };
  if (/^drinks?$|^bar menu$|^beverages?$/.test(plain)) return { section: "drinks", title };
  if (/^staff(ing)?$/.test(plain)) return { section: "staff", title };
  if (/^schedule\b/.test(plain) || /^timeline$|^run of show$/.test(plain)) return { section: "schedule", title };
  if (/^setup decor list$|^set up decor list$|^setup and decor$|^decor list$/.test(plain)) return { section: "setup", title };
  // Further template sections: kept whole.
  if (/^(layout|inventory\b.*|bar pull list|pull list|photos?\b.*)$/.test(plain)) return { section: "other", title };
  return null;
};

const summaryLabels: [RegExp, BeoImportSummaryKey][] = [
  [/^client(?:'s|’s)?(?: name)?$/i, "client"],
  [/^(?:event )?date$|^date of event$/i, "date"],
  [/^(?:event )?(?:address|location)$/i, "address"],
  [/^(?:# of guests|guests|guest count|number of guests)$/i, "guests"],
  [/^event type$|^type of (?:event|service)$/i, "eventType"],
  [/^components$/i, "components"],
  [/^transportation$/i, "transportation"],
];

// "9:30AM", "12PM", "4PM-4:30PM", "4:30-5:30PM": the start time, 24-hour.
const clock = String.raw`\d{1,2}(?::[0-5]\d)?\s*(?:[ap]\.?m\.?)?`;
const timeRange = new RegExp(String.raw`^(${clock})(?:\s*(?:-|–|—|to)\s*(${clock}))?\s*[-–—:]?\s*(.*)$`, "i");
function startTime(start: string, end: string | undefined): string | null {
  const direct = proposalTime(start);
  if (direct && /[ap]/i.test(start)) return direct;
  // "4:30-5:30PM": the start shares the end's am/pm.
  const meridiem = end?.match(/([ap])\.?m/i)?.[1];
  return proposalTime(meridiem ? `${start}${meridiem}m` : start) ?? direct;
}
function scheduleLine(value: string): BeoImportScheduleRow | null {
  const match = timeRange.exec(clean(value));
  if (!match) return null;
  const time = startTime(match[1].trim(), match[2]?.trim());
  if (!time) return null;
  const cue = clean(match[3]).replace(/^[;:,-]\s*/, "").replace(/[;:,]$/, "");
  if (!cue) return null;
  return { time, cue, notes: match[2] ? `Until ${clean(match[2])}` : "", source: clean(value) };
}

export function extractBeo(blocks: BeoImportBlock[]): BeoImportDraft {
  const draft: BeoImportDraft = {
    summary: {}, durations: [], menu: [], drinks: [], staff: [], schedule: [], setup: [], other: [], unrecognized: [],
  };
  let section: Section = "none";
  let first = true;
  for (const block of blocks) {
    const value = clean(block.text);
    if (!value) continue;
    // The first line is the title: "BEO <event title>".
    if (first) {
      first = false;
      const title = /^b\.?e\.?o\.?\s*[-–—:]?\s*(.+)$/i.exec(value);
      if (title) {
        draft.summary.title = title[1].trim();
        continue;
      }
    }
    if (block.kind !== "table") {
      const next = heading(value);
      if (next) {
        section = next.section;
        if (section === "other") draft.other.push({ heading: next.title, lines: [] });
        continue;
      }
    }
    if (section === "schedule" && block.kind === "table") {
      const [time = "", what = "", details = ""] = (block.rows?.[0] ?? []).map(clean);
      // The TIME / EVENT / DETAILS header row.
      if (/^time$/i.test(time) && /^event$/i.test(what)) continue;
      const row = scheduleLine(`${time} ${what}`);
      if (row) draft.schedule.push({ ...row, notes: [row.notes, details].filter(Boolean).join(" · ") });
      else draft.unrecognized.push(value);
      continue;
    }
    switch (section) {
      case "summary":
      case "duration": {
        const pair = /^([^:]{1,40}):\s*(.*)$/.exec(value);
        if (pair && /^duration$/i.test(pair[1].trim())) {
          section = "duration";
          if (pair[2].trim()) draft.durations.push(clean(pair[2]));
          break;
        }
        const key = pair && summaryLabels.find(([label]) => label.test(pair[1].trim()))?.[1];
        if (pair && key) {
          section = "summary";
          if (pair[2].trim()) draft.summary[key] = clean(pair[2]);
        } else if (section === "duration") draft.durations.push(value);
        else draft.unrecognized.push(value);
        break;
      }
      case "menu":
        draft.menu.push(value);
        break;
      case "drinks":
        draft.drinks.push(value);
        break;
      case "staff":
        draft.staff.push(value);
        break;
      case "schedule": {
        const row = scheduleLine(value);
        if (row) draft.schedule.push(row);
        else draft.unrecognized.push(value);
        break;
      }
      case "setup":
        draft.setup.push(value);
        break;
      case "other":
        draft.other.at(-1)!.lines.push(value);
        break;
      default:
        draft.unrecognized.push(value);
    }
  }
  return draft;
}

// The event fields an import that creates the event (Q4) reads from the summary.
export function eventFromSummary(draft: Pick<BeoImportDraft, "summary" | "schedule">) {
  const guests = draft.summary.guests?.match(/\d{1,6}/)?.[0];
  return {
    title: draft.summary.title ?? "",
    date: proposalDate(draft.summary.date ?? "") ?? "",
    startTime: "",
    guestCount: guests ? Number(guests) : null,
    address: draft.summary.address ?? "",
    eventType: draft.summary.eventType ?? "",
  };
}

const lines = (title: string, values: string[]) => (values.length ? [`${title}\n${values.join("\n")}`] : []);
// The BEO notes the import writes: the summary, menu, drinks, staff, further
// sections and anything unrecognized (AC3), each under its heading.
export function importedNotes(draft: BeoImportDraft) {
  const summary = beoImportSummaryKeys
    .filter((key) => draft.summary[key])
    .map((key) => `${beoImportSummaryLabels[key]}: ${draft.summary[key]}`)
    .concat(draft.durations.map((line) => `Duration: ${line}`));
  return [
    ...lines("Event summary", summary),
    ...lines("Menu", draft.menu),
    ...lines("Drinks", draft.drinks),
    ...lines("Staff", draft.staff),
    // A further section keeps its heading even when it has no text of its own.
    ...draft.other.map((section) => [section.heading, ...section.lines].join("\n")),
    ...lines("Not recognized", draft.unrecognized),
  ].join("\n\n");
}

// POST /api/beos/import: the reviewed values (nothing is saved before this).
// Either an existing event, or a new one from the summary (Q4).
export const beoImportNewEventSchema = z.object({
  title: text(200).min(1, "The event needs a title."),
  date: localDate,
  startTime: localTime,
  guestCount: z.number().int().min(0).max(100_000).nullable().default(null),
  address: text(500).default(""),
  eventType: text(100).default(""),
});
export const beoImportInputSchema = z
  .object({
    eventId: id.optional(),
    newEvent: beoImportNewEventSchema.optional(),
    runOfShow: z.array(runOfShowRowInputSchema).max(200).default([]),
    setupDetails: text(20_000).default(""),
    additionalNotes: text(20_000).default(""),
    fileName: text(200).min(1),
  })
  .strict()
  .refine((input) => Boolean(input.eventId) !== Boolean(input.newEvent), "Choose an event, or create one from the file.");
export type BeoImportInput = z.input<typeof beoImportInputSchema>;
export const beoImportResultSchema = z.object({ eventId: id, beoId: id, created: z.boolean() });
export type BeoImportResult = z.infer<typeof beoImportResultSchema>;

// Q3: Word files and PDFs (text PDFs only).
export const beoImportTypes = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
} as const;
export function beoImportKind(file: { name: string; type: string }): "docx" | "pdf" | null {
  const extension = file.name.split(".").at(-1)?.toLowerCase();
  if (extension === "docx" || file.type === beoImportTypes.docx) return "docx";
  if (extension === "pdf" || file.type === beoImportTypes.pdf) return "pdf";
  return null;
}
