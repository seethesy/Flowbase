import { z } from "zod";
import { eventStatusSchema } from "./core-records";
import { leadStatusSchema } from "./leads";
import { proposalStageSchema } from "./proposals";
import { id, localDate, timestamp } from "./schema-primitives";

export const salesFilterSchema = z.object({
  kind: z.enum(["all", "lead", "client", "event", "proposal"]).default("all"),
  stage: z.string().max(100).default(""),
  owner: id.optional(),
  search: z.string().max(200).default(""),
  history: z.boolean().default(false),
  sort: z.enum(["activity", "eventDate", "client", "total"]).default("activity"),
});
export type SalesFilter = z.infer<typeof salesFilterSchema>;
export const salesViewInputSchema = z.object({ name: z.string().trim().min(1).max(80), filter: salesFilterSchema });
export const salesViewSchema = salesViewInputSchema.extend({ id, createdAt: timestamp });

export const salesRowSchema = z.object({
  id, kind: z.enum(["lead", "client", "event", "proposal"]),
  clientId: id.nullable(), client: z.string(), eventId: id.nullable(),
  title: z.string(), eventDate: localDate.nullable(), eventType: z.string(),
  stage: z.string(), ownerId: id.nullable(), owner: z.string().nullable(),
  source: z.string().nullable(), totalCents: z.number().int().nullable(),
  receivedCents: z.number().int().nullable(), balanceCents: z.number().int().nullable(),
  lastActivity: timestamp, nextFollowUp: timestamp.nullable(),
  bookedAt: timestamp.nullable(), eventStatus: eventStatusSchema.nullable(),
  leadStatus: leadStatusSchema.nullable(),
  proposalStage: proposalStageSchema.nullable(),
  versionNumber: z.number().int().nullable(),
});
export type SalesRow = z.infer<typeof salesRowSchema>;
export const salesDataSchema = z.object({ rows: salesRowSchema.array() });
export const salesClientSchema = z.object({
  clientId: id, events: z.array(z.object({
    eventId: id, title: z.string(), status: eventStatusSchema,
    eventDate: localDate, bookedAt: timestamp.nullable(),
    totalCents: z.number().int().nullable(), receivedCents: z.number().int(),
    balanceCents: z.number().int().nullable(),
    proposals: z.array(z.object({ id, title: z.string(), stage: proposalStageSchema,
      versions: z.array(z.object({ id, number: z.number().int(), totalCents: z.number().int().nullable() })) })),
  })),
  eventCount: z.number().int(), lifetimeBookedCents: z.number().int(),
});
export const salesReportSchema = z.object({
  pipeline: z.array(z.object({ stage: proposalStageSchema, count: z.number().int(), totalCents: z.number().int() })),
  bookedByMonth: z.array(z.object({ month: z.string(), count: z.number().int(), totalCents: z.number().int() })),
  winBySalesperson: z.array(z.object({ owner: z.string(), wins: z.number().int(), decided: z.number().int(), rate: z.number().nullable() })),
  winBySource: z.array(z.object({ source: z.string(), wins: z.number().int(), decided: z.number().int(), rate: z.number().nullable() })),
});

export function filterSalesRows(rows: SalesRow[], filter: SalesFilter) {
  const term = filter.search.toLocaleLowerCase();
  return rows.filter((row) =>
    (filter.kind === "all" || row.kind === filter.kind) &&
    (filter.history || !["finished", "lost"].includes(row.eventStatus ?? "")) &&
    (!filter.stage || row.stage === filter.stage) &&
    (!filter.owner || row.ownerId === filter.owner) &&
    (!term || [row.client, row.title, row.source ?? ""].some((value) => value.toLocaleLowerCase().includes(term)))
  ).sort((a, b) => {
    if (filter.sort === "client") return a.client.localeCompare(b.client) || a.id.localeCompare(b.id);
    if (filter.sort === "total") return (b.totalCents ?? -1) - (a.totalCents ?? -1) || a.id.localeCompare(b.id);
    if (filter.sort === "eventDate") return (a.eventDate ?? "9999").localeCompare(b.eventDate ?? "9999") || a.id.localeCompare(b.id);
    return b.lastActivity.localeCompare(a.lastActivity) || a.id.localeCompare(b.id);
  });
}

export function salesCsv(rows: SalesRow[]) {
  const quote = (value: string | number | null) => {
    const content = String(value ?? "");
    const safe = /^[\s]*[=+@-]/.test(content) && typeof value === "string" ? `'${content}` : content;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  return ["Type,Client,Title,Event date,Event type,Stage,Salesperson,Source,Total,Received,Balance,Last activity,Next follow-up",
    ...rows.map((row) => [row.kind, row.client, row.title, row.eventDate, row.eventType, row.stage,
      row.owner, row.source, row.totalCents === null ? null : row.totalCents / 100,
      row.receivedCents === null ? null : row.receivedCents / 100,
      row.balanceCents === null ? null : row.balanceCents / 100,
      row.lastActivity, row.nextFollowUp].map(quote).join(","))].join("\r\n");
}
