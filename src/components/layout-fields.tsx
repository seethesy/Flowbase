import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
// The app's client, named so pages render without a QueryClientProvider too (tests mount pages bare).
import { queryClient } from "../app/queryClient";
import { LabelT, T } from "../app/copy";
import { copySlug } from "../../shared/copy";
import { fieldDef, type FieldDef, type SourceKey } from "../../shared/fields";
import { pipelineStatusSchema } from "../../shared/pipeline";
import { BUSINESS_TIME_ZONE } from "../../shared/time";
import { staffApi } from "../services/staff";
import { StatusPill } from "./ui/status-pill";

// Values and labels of registry fields (FLOW-253), rendered by type: status as
// a StatusPill (FLOW-251) or its label, person as a name, money as currency,
// dates in business time, links as links. Used by table columns (FLOW-254),
// field boxes (FLOW-255) and custom cards (FLOW-256).

// A field's label, editable live like any other built-in string.
export function FieldLabel({ source, field }: { source: SourceKey; field: string }) {
  const def = fieldDef(source, field);
  if (!def) return <>{field}</>;
  return <T id={`fields.${source}.${copySlug(def.key)}`}>{def.label}</T>;
}

// People are stored by id on some records; the staff directory names them.
function PersonName({ id }: { id: string }) {
  const staff = useQuery({ queryKey: ["staff", "directory"], queryFn: staffApi.list, staleTime: 5 * 60_000 }, queryClient);
  return <>{staff.data?.find((person) => person.id === id)?.name ?? "—"}</>;
}

const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const day = (value: string) => {
  // A wall-clock date (YYYY-MM-DD) or an instant.
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00Z`) : new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-US", { timeZone: BUSINESS_TIME_ZONE, month: "short", day: "numeric", year: "numeric" });
};
const stamp = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("en-US", { timeZone: BUSINESS_TIME_ZONE, dateStyle: "medium", timeStyle: "short" });
};
const named = (value: unknown): string => {
  if (value && typeof value === "object") {
    const record = value as { name?: unknown; title?: unknown };
    return String(record.name ?? record.title ?? "");
  }
  return value === null || value === undefined ? "" : String(value);
};
const isEmpty = (value: unknown) =>
  value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);

function statusValue(def: FieldDef, value: string): ReactNode {
  if (def.options?.pill && pipelineStatusSchema.safeParse(value).success)
    return <StatusPill status={value as never} />;
  if (def.options?.pill && (value === "preparation" || value === "finished")) return <StatusPill status={value} />;
  const label = def.options?.labels[value];
  return label ? <LabelT id={def.options!.copyId} value={value}>{label}</LabelT> : value;
}

// One field's value on one row. Empty values show a dash.
export function FieldValue({ source, field, row }: { source: SourceKey; field: string; row: Record<string, unknown> }) {
  const def = fieldDef(source, field);
  const value = row[field];
  if (!def || isEmpty(value)) return <>—</>;
  switch (def.type) {
    case "number":
      return <>{Number(value).toLocaleString("en-US")}</>;
    case "money":
      return <>{money(Number(value))}</>;
    case "date":
      return <>{day(String(value))}</>;
    case "datetime":
      return <>{stamp(String(value))}</>;
    case "boolean":
      return value ? <T id="fields.value.yes">Yes</T> : <T id="fields.value.no">No</T>;
    case "status":
      return <>{statusValue(def, String(value))}</>;
    case "person": {
      const people = Array.isArray(value) ? value : [value];
      return (
        <>
          {people.map((person, index) => (
            <span key={index}>
              {index > 0 && ", "}
              {typeof person === "string" ? <PersonName id={person} /> : named(person)}
            </span>
          ))}
        </>
      );
    }
    case "link": {
      const href = def.href?.(row);
      const text = named(value);
      return href ? <Link to={href}>{text}</Link> : <>{text}</>;
    }
    default:
      return <>{Array.isArray(value) ? value.map(named).join(", ") : named(value)}</>;
  }
}

// The value as plain text, for sorting and CSV export.
export function fieldText(source: SourceKey, field: string, row: Record<string, unknown>): string | number | null {
  const def = fieldDef(source, field);
  const value = row[field];
  if (!def || isEmpty(value)) return null;
  if (def.type === "number" || def.type === "money") return Number(value);
  if (def.type === "status") return def.options?.labels[String(value)] ?? String(value);
  if (def.type === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.map(named).join(", ");
  return named(value);
}
