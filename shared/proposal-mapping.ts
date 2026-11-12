import { z } from "zod";
import { id } from "./schema-primitives";

export const proposalLineKinds = ["menu", "rental", "decor", "service", "supply"] as const;
export const proposalLineSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(proposalLineKinds),
  section: z.string().max(100).default(""),
  name: z.string().trim().min(1).max(200),
  notes: z.string().max(2000).default(""),
  quantity: z.number().nonnegative().nullable().default(null),
  sourceBlockId: z.string().nullable().default(null),
  catalogId: id.nullable().default(null),
  notTracked: z.boolean().default(false),
});
export type ProposalLine = z.infer<typeof proposalLineSchema>;
const sourced = z.object({ value: z.string().max(2000), sourceBlockId: z.string().nullable() });
export const proposalMappingSchema = z.object({
  versionId: id,
  // Reviewed against this version of the document; null until confirmed.
  totalCents: z.number().int().nonnegative().nullable().default(null),
  fields: z.record(z.string(), sourced).default({}),
  lines: z.array(proposalLineSchema).max(500).default([]),
  staffing: z.array(z.object({ position: z.string().min(1).max(100), count: z.number().int().min(1).max(30), sourceBlockId: z.string().nullable() })).max(100).default([]),
  timeline: z.array(sourced).max(100).default([]),
  charges: z.array(sourced).max(100).default([]),
  paymentSchedule: z.array(sourced).max(100).default([]),
  unextractedBlockIds: z.array(z.string()).default([]),
});
export type ProposalMapping = z.infer<typeof proposalMappingSchema>;
export const proposalCatalogSchema = z.object({
  recipes: z.array(z.object({ id, name: z.string() })),
  items: z.array(z.object({ id, name: z.string(), kind: z.string(), subtype: z.string().nullable() })),
});

export function unmatchedLines(mapping: ProposalMapping): string[] {
  return mapping.lines.filter((line) =>
    ["menu", "rental", "decor", "service"].includes(line.kind) &&
    !line.catalogId && !line.notTracked,
  ).map((line) => line.name);
}

export type ProposalChange = { path: string; oldValue: unknown; newValue: unknown };
export function diffProposalMappings(previous: ProposalMapping, next: ProposalMapping): ProposalChange[] {
  const changes: ProposalChange[] = [];
  const compare = (path: string, oldValue: unknown, newValue: unknown) => {
    if (JSON.stringify(oldValue ?? null) !== JSON.stringify(newValue ?? null))
      changes.push({ path, oldValue: oldValue ?? null, newValue: newValue ?? null });
  };
  compare("totalCents", previous.totalCents, next.totalCents);
  for (const key of new Set([...Object.keys(previous.fields), ...Object.keys(next.fields)]))
    compare(`fields.${key}`, previous.fields[key]?.value, next.fields[key]?.value);
  const oldLines = new Map(previous.lines.map((line) => [line.id, line]));
  const newLines = new Map(next.lines.map((line) => [line.id, line]));
  for (const id of new Set([...oldLines.keys(), ...newLines.keys()])) {
    const old = oldLines.get(id), current = newLines.get(id);
    for (const key of ["kind", "section", "name", "notes", "quantity", "catalogId", "notTracked"] as const)
      compare(`lines.${id}.${key}`, old?.[key], current?.[key]);
  }
  for (const key of ["staffing", "timeline", "charges", "paymentSchedule"] as const)
    compare(key, previous[key].map((item) => "value" in item ? item.value : `${item.position}: ${item.count}`),
      next[key].map((item) => "value" in item ? item.value : `${item.position}: ${item.count}`));
  return changes;
}

const normalize = (name: string) => name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
export function suggestCatalog<T extends { id: string; name: string }>(name: string, catalog: T[]): T[] {
  const query = normalize(name);
  if (!query) return [];
  const words = new Set(query.split(" "));
  return catalog.map((item) => {
    const candidate = normalize(item.name);
    const shared = candidate.split(" ").filter((word) => words.has(word)).length;
    return { item, score: candidate === query ? 100 : candidate.includes(query) || query.includes(candidate) ? 50 : shared };
  }).filter(({ score }) => score > 0).sort((a, b) => b.score - a.score).slice(0, 5).map(({ item }) => item);
}
