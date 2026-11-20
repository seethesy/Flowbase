import type { Actor } from "../access";
import { can } from "../policy";
import { clientFields } from "./clients";
import { eventFields } from "./events";
import { inventoryFields } from "./inventory";
import { leadFields } from "./leads";
import { proposalFields } from "./proposals";
import { staffFields } from "./staff";
import { taskFields } from "./tasks";
import { sourceKeys, type FieldDef, type SourceDef, type SourceKey } from "./types";
import { vendorFields } from "./vendors";
import { venueFields } from "./venues";

export * from "./types";

// One registry per source (FLOW-253), keyed by source.
export const fieldRegistry: Record<SourceKey, SourceDef> = {
  leads: leadFields,
  events: eventFields,
  clients: clientFields,
  proposals: proposalFields,
  tasks: taskFields,
  inventory: inventoryFields,
  staff: staffFields,
  venues: venueFields,
  vendors: vendorFields,
};

export const isSourceKey = (value: unknown): value is SourceKey =>
  typeof value === "string" && (sourceKeys as readonly string[]).includes(value);

export function fieldDef(source: SourceKey, key: string): FieldDef | undefined {
  return fieldRegistry[source].fields.find((field) => field.key === key);
}

// May the viewer read this field (on this row, when given)? Never without read
// access to the source itself.
export function canReadField(
  actor: Actor,
  source: SourceKey,
  key: string,
  row?: Record<string, unknown>,
): boolean {
  const def = fieldDef(source, key);
  if (!def || !can(actor, fieldRegistry[source].readAction)) return false;
  return def.read ? def.read(actor, row) : true;
}

export const readableFields = (actor: Actor, source: SourceKey): FieldDef[] =>
  can(actor, fieldRegistry[source].readAction)
    ? fieldRegistry[source].fields.filter((field) => !field.read || field.read(actor))
    : [];

// The row with only the asked-for registry fields the viewer may read on it,
// plus the record's id (and an event id, which record links need). Unknown and
// unreadable fields are dropped, never returned.
export function projectRecord(
  actor: Actor,
  source: SourceKey,
  row: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if ("id" in row) result.id = row.id;
  if ("eventId" in row) result.eventId = row.eventId;
  for (const key of keys) if (key in row && canReadField(actor, source, key, row)) result[key] = row[key];
  return result;
}

// `fields=a,b,c`: the requested keys, or the unknown ones as an error.
export function parseFieldList(
  source: SourceKey,
  value: string,
): { keys: string[] } | { unknown: string[] } {
  const keys = [...new Set(value.split(",").map((key) => key.trim()).filter(Boolean))];
  const unknown = keys.filter((key) => !fieldDef(source, key));
  return unknown.length ? { unknown } : { keys };
}
