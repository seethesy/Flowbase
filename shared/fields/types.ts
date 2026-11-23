import type { Actor } from "../access";
import { can, type Action } from "../policy";

// The field registry (FLOW-253): every field a layout may show, per source.
// Table columns (FLOW-254), field boxes (FLOW-255) and custom cards (FLOW-256)
// pick fields from here, and the Worker's `fields=` returns only fields the
// viewer may read. Keys are the API record's top-level keys.

export const fieldTypes = [
  "text",
  "number",
  "date",
  "datetime",
  "money",
  "status",
  "person",
  "link",
  "boolean",
] as const;
export type FieldType = (typeof fieldTypes)[number];

// Whether the viewer may read the field. Without a row it answers for the
// column as a whole (may the viewer read it on any row); with one, for that row.
export type ReadRule = (actor: Actor, row?: Record<string, unknown>) => boolean;

export type FieldDef = {
  key: string;
  // Default label, editable live through <T> under `fields.<source>.<key>`.
  label: string;
  type: FieldType;
  read?: ReadRule;
  // The record's own Edit mode or an inline cell may change it.
  editable?: boolean;
  // Always shown: can't be hidden as a column or a field box.
  required?: boolean;
  sortable?: boolean;
  filterable?: boolean;
  // Labels for a status's stored values, with their live-edit key prefix.
  options?: { labels: Record<string, string>; copyId: string; pill?: boolean };
  // Where a link or person value goes (an app route).
  href?: (row: Record<string, unknown>) => string | null;
};

export const sourceKeys = [
  "working-staff",
  "sops",
  "recipes",
  "leads",
  "events",
  "clients",
  "proposals",
  "tasks",
  "inventory",
  "staff",
  "venues",
  "vendors",
] as const;
export type SourceKey = (typeof sourceKeys)[number];

// A list of records related to the one a record page shows, e.g. a lead's events.
export type Relation = {
  key: string;
  label: string;
  source: SourceKey;
  // The list endpoint for one record's related rows.
  path: (recordId: string) => string;
};

export type SourceDef = {
  key: SourceKey;
  label: string;
  readAction: Action;
  // List and detail endpoints (both accept `fields=`).
  listPath: string;
  detailPath: (id: string) => string;
  // The app route that opens a record.
  recordRoute: (row: Record<string, unknown>) => string | null;
  // The field a row is named by in a card or link.
  titleField: string;
  fields: FieldDef[];
  relations?: Relation[];
};

// Readable by everyone who may read the source.
export const sourceRead = (source: Pick<SourceDef, "readAction">) => (actor: Actor) =>
  can(actor, source.readAction);

export const id = (value: unknown) => (typeof value === "string" ? value : null);
export const nested = (row: Record<string, unknown>, key: string) => {
  const value = row[key];
  return value && typeof value === "object" && "id" in value ? id((value as { id: unknown }).id) : null;
};
