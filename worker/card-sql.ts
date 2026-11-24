import { sql, type AnyColumn, type SQL } from "drizzle-orm";
import type { Actor } from "../shared/access";
import { fieldDef, type SourceKey } from "../shared/fields";
import type { CardFilter } from "../shared/layout";
import { BUSINESS_TIME_ZONE } from "../shared/time";
import { clients, events, leads, tasks, vendors, venues } from "./db/schema";
import type { CardSql } from "./records/core/paging";

// Custom cards in SQL (FLOW-308). A card's filters, sort and row limit become
// conditions on the list's own table, added to the list endpoint's own query
// (its row scope and visibility stay exactly as they are), so a card costs one
// query that reads only the rows it shows.
//
// Only fields stored as a plain column of the list's table, with no read rule
// of their own, go into SQL. Every other field (computed, joined or hidden from
// some viewers) is filtered and sorted in memory by worker/fields.ts, on at most
// one page of the list. worker/fields.ts always re-applies the card in memory
// on the rows that come back, so this only narrows what is read: when a filter
// or the sort can't run in SQL, the query keeps the conditions that can and
// reads one page instead of `take` rows.

type Column = AnyColumn | SQL;

// The API record's key -> the column it is read from, per source. A key is
// listed only when the list returns the column's value unchanged under it.
const cardColumns: Partial<Record<SourceKey, Record<string, Column>>> = {
  leads: {
    name: leads.name,
    status: leads.status,
    eventName: leads.eventName,
    eventDate: leads.eventDate,
    guestCount: leads.guestCount,
    eventType: leads.eventType,
    location: leads.location,
    source: leads.source,
    channel: leads.channel,
    assignedSalespersonId: leads.assignedSalespersonId,
    receivedAt: leads.receivedAt,
    firstRespondedAt: leads.firstRespondedAt,
    createdAt: leads.createdAt,
    updatedAt: leads.updatedAt,
  },
  events: {
    title: events.title,
    status: events.status,
    // The event's date in business time, as the list returns it.
    date: sql`(${events.startsAt} at time zone ${BUSINESS_TIME_ZONE})::date`,
    startsAt: events.startsAt,
    endsAt: events.endsAt,
    address: events.address,
    eventType: events.eventType,
    serviceType: events.serviceType,
    foodServiceStyle: events.foodServiceStyle,
    guestCount: events.guestCount,
    servingsCount: events.servingsCount,
    assignedSalespersonId: events.assignedSalespersonId,
    productionLeadId: events.productionLeadId,
    bookedAt: events.bookedAt,
    createdAt: events.createdAt,
    updatedAt: events.updatedAt,
  },
  clients: {
    name: clients.name,
    kind: clients.kind,
    assignedSalespersonId: clients.assignedSalespersonId,
    notes: clients.notes,
    createdAt: clients.createdAt,
    updatedAt: clients.updatedAt,
  },
  venues: {
    name: venues.name,
    address: venues.address,
    jurisdiction: venues.jurisdiction,
    updatedAt: venues.updatedAt,
  },
  vendors: {
    name: vendors.name,
    type: vendors.type,
    orderCutoff: vendors.orderCutoff,
    minimumOrderCents: vendors.minimumOrderCents,
    leadTimeDays: vendors.leadTimeDays,
    updatedAt: vendors.updatedAt,
  },
  tasks: {
    title: tasks.title,
    type: tasks.type,
    status: tasks.status,
    priority: tasks.priority,
    dueAt: tasks.dueAt,
    completedAt: tasks.completedAt,
    createdAt: tasks.createdAt,
  },
};

// Rows a card reads when part of it runs in memory: one list page.
export const CARD_MEMORY_ROWS = 500;

// The column for a field when it can run in SQL for every viewer: a plain
// column with no read rule (a read rule can hide it on some rows).
function column(source: SourceKey, field: string): Column | undefined {
  const def = fieldDef(source, field);
  if (!def || def.read) return undefined;
  return cardColumns[source]?.[field];
}

const no = sql`false`;
// Text as the in-memory filter sees it: lower case, empty when null.
const lowered = (value: Column) => sql`lower(coalesce(${value}::text, ''))`;
// Times compare at millisecond precision, as JavaScript dates do.
const instant = (value: Column, type: string) =>
  type === "date"
    ? sql`((${value})::timestamp at time zone 'UTC')`
    : sql`date_trunc('milliseconds', ${value})`;
const parsedTime = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const time = Date.parse(String(value));
  return Number.isNaN(time) ? null : new Date(time).toISOString();
};

// The filter as SQL with the same meaning as `matches` in worker/fields.ts, or
// undefined when it can't run in SQL.
function filterSql(actor: Actor, source: SourceKey, filter: CardFilter, now: Date): SQL | undefined {
  const value = column(source, filter.field);
  const def = fieldDef(source, filter.field);
  if (!value || !def) return undefined;
  const wanted = filter.value;
  const { type } = def;
  switch (filter.op) {
    case "is_empty":
      return type === "number" || type === "money" || type === "boolean" || type === "date" || type === "datetime"
        ? sql`(${value} is null)`
        : sql`(${value} is null or ${value}::text = '')`;
    case "is_me":
      return sql`coalesce(${value}::text = ${actor.userId}, false)`;
    case "is":
    case "is_not": {
      let same: SQL;
      if (type === "person") same = sql`coalesce(${value}::text = ${String(wanted ?? "")}, false)`;
      else if (type === "boolean") same = sql`(coalesce(${value}, false) = ${String(wanted) === "true"}::boolean)`;
      else if (type === "number" || type === "money") {
        const number = Number(wanted);
        same = Number.isFinite(number) ? sql`coalesce(${value} = ${number}::numeric, false)` : no;
      } else if (type === "date" || type === "datetime") return undefined;
      else same = sql`(${lowered(value)} = ${String(wanted ?? "").toLowerCase()})`;
      return filter.op === "is" ? same : sql`(not ${same})`;
    }
    case "contains":
      if (type === "date" || type === "datetime" || type === "number" || type === "money") return undefined;
      return sql`(strpos(${lowered(value)}, ${String(wanted ?? "").toLowerCase()}) > 0)`;
    case "before":
    case "after": {
      const operator = sql.raw(filter.op === "before" ? "<" : ">");
      if (type === "number" || type === "money") {
        if (wanted === null || wanted === undefined || wanted === "") return no;
        const number = Number(wanted);
        if (Number.isNaN(number)) return no;
        return sql`coalesce(${value} ${operator} ${number}::numeric, false)`;
      }
      if (type === "date" || type === "datetime") {
        const time = parsedTime(wanted);
        if (!time) return no;
        return sql`coalesce(${instant(value, type)} ${operator} ${time}::timestamptz, false)`;
      }
      return undefined;
    }
    case "within_days": {
      if (type !== "date" && type !== "datetime") return undefined;
      const days = Number(wanted);
      if (!Number.isFinite(days)) return no;
      const start = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
      const end = new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
      return sql`coalesce(${instant(value, type)} >= ${start}::timestamptz and ${instant(value, type)} <= ${end}::timestamptz, false)`;
    }
  }
  return undefined;
}

// The sort as SQL, empty values last whichever the direction, or undefined.
function sortSql(source: SourceKey, sort: { field: string; dir: "asc" | "desc" }): SQL | undefined {
  const value = column(source, sort.field);
  const def = fieldDef(source, sort.field);
  if (!value || !def) return undefined;
  const key =
    def.type === "number" || def.type === "money" || def.type === "boolean"
      ? sql`${value}`
      : def.type === "date" || def.type === "datetime"
        ? instant(value, def.type)
        : // Text sorts as the lower-cased value, compared code point by code point.
          sql`nullif(lower(${value}::text), '') collate "C"`;
  return sql`${key} ${sql.raw(sort.dir === "asc" ? "asc" : "desc")} nulls last`;
}

export type CardQueryInput = {
  filters: CardFilter[];
  sort?: { field: string; dir: "asc" | "desc" };
  take: number;
};

// The card's query for the source's main list endpoint. With every filter and
// the sort in SQL it reads exactly `take` rows; otherwise one page.
export function compileCardSql(
  actor: Actor,
  source: SourceKey,
  query: CardQueryInput,
  now = new Date(),
): CardSql {
  if (!cardColumns[source]) return { orderBy: [], limit: CARD_MEMORY_ROWS };
  const filters = query.filters.map((filter) => filterSql(actor, source, filter, now));
  const sort = query.sort ? sortSql(source, query.sort) : undefined;
  const inSql = filters.filter((filter): filter is SQL => filter !== undefined);
  const exact = inSql.length === filters.length && (!query.sort || sort !== undefined);
  return {
    where: inSql.length ? sql`(${sql.join(inSql, sql` and `)})` : undefined,
    // Without the sort in SQL, the page is read in the list's own order and
    // sorted in memory.
    orderBy: sort ? [sort] : [],
    limit: exact ? query.take : CARD_MEMORY_ROWS,
  };
}
