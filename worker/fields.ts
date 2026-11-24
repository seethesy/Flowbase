import type { MiddlewareHandler } from "hono";
import type { Actor } from "../shared/access";
import {
  canReadField,
  fieldDef,
  fieldRegistry,
  parseFieldList,
  projectRecord,
  type SourceKey,
} from "../shared/fields";
import {
  cardFilterSchema,
  MAX_CARD_ROWS,
  operatorsFor,
  type CardFilter,
} from "../shared/layout";
import { ApiError, type AppEnv } from "./hono";
import { CARD_MEMORY_ROWS, compileCardSql } from "./card-sql";

// `fields=` on list and detail endpoints (FLOW-253) and card queries (FLOW-256).
//
// GET <list or detail>?fields=a,b returns only those registry fields the viewer
// may read; every other field is dropped. The endpoint itself still applies its
// own row scope and field redaction first, so a projection can only narrow.
//
// A custom card adds where=<json filters>, orderBy=<field>:<asc|desc> and
// take=<n> to a list request. The list endpoint runs it in its own query
// (FLOW-308, worker/card-sql.ts), then the rows are filtered, sorted and cut to
// take again here, on fields the viewer may read only: a filter or sort on a
// field the viewer can't read sees it as empty, so it can't reveal hidden
// values.

const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const routes: { pattern: RegExp; source: SourceKey; detail: boolean }[] = [
  ...(Object.values(fieldRegistry).flatMap((def) => {
    const list = def.listPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return [
      { pattern: new RegExp(`^${list}$`), source: def.key, detail: false },
      { pattern: new RegExp(`^${list}/${uuid}$`, "i"), source: def.key, detail: true },
    ];
  }) as { pattern: RegExp; source: SourceKey; detail: boolean }[]),
  { pattern: new RegExp(`^/api/vendors/${uuid}/items$`, "i"), source: "inventory", detail: false },
  { pattern: new RegExp(`^/api/sales/clients/${uuid}/proposals$`, "i"), source: "proposals", detail: false },
  // A lead's events (related list).
  { pattern: new RegExp(`^/api/leads/${uuid}/events$`, "i"), source: "events", detail: false },
];
export const fieldRoute = (path: string) => routes.find((route) => route.pattern.test(path)) ?? null;

type Row = Record<string, unknown>;

const empty = (value: unknown) =>
  value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
const personIds = (value: unknown): string[] => {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(personIds);
  if (value && typeof value === "object" && "id" in value && typeof value.id === "string") return [value.id];
  return [];
};
const text = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(text).join(", ");
  if (typeof value === "object") {
    const named = value as { name?: unknown; title?: unknown };
    return String(named.name ?? named.title ?? "");
  }
  return String(value);
};
const comparable = (value: unknown, type: string): number | string | null => {
  if (empty(value)) return null;
  if (type === "number" || type === "money") return Number(value);
  if (type === "date" || type === "datetime") {
    const time = Date.parse(String(value));
    return Number.isNaN(time) ? null : time;
  }
  if (type === "boolean") return value ? 1 : 0;
  return text(value).toLowerCase();
};

function matches(actor: Actor, source: SourceKey, row: Row, filter: CardFilter, now: Date): boolean {
  const def = fieldDef(source, filter.field)!;
  // Unreadable on this row: the filter sees an empty value.
  const value = canReadField(actor, source, filter.field, row) ? row[filter.field] : null;
  const wanted = filter.value;
  switch (filter.op) {
    case "is_empty":
      return empty(value);
    case "is_me":
      return personIds(value).includes(actor.userId);
    case "is":
    case "is_not": {
      let same: boolean;
      if (def.type === "person") same = personIds(value).includes(String(wanted ?? ""));
      else if (def.type === "boolean") same = Boolean(value) === (String(wanted) === "true");
      else if (def.type === "number" || def.type === "money") same = !empty(value) && Number(value) === Number(wanted);
      else same = text(value).toLowerCase() === String(wanted ?? "").toLowerCase();
      return filter.op === "is" ? same : !same;
    }
    case "contains":
      return text(value).toLowerCase().includes(String(wanted ?? "").toLowerCase());
    case "before":
    case "after": {
      const left = comparable(value, def.type);
      const right = comparable(wanted, def.type);
      if (left === null || right === null) return false;
      return filter.op === "before" ? left < right : left > right;
    }
    case "within_days": {
      const time = comparable(value, def.type);
      const days = Number(wanted);
      if (typeof time !== "number" || !Number.isFinite(days)) return false;
      const start = now.getTime() - 24 * 60 * 60 * 1000;
      return time >= start && time <= now.getTime() + days * 24 * 60 * 60 * 1000;
    }
  }
}

export type CardQuery = {
  filters: CardFilter[];
  sort?: { field: string; dir: "asc" | "desc" };
  take: number;
};

// Parses where/orderBy/take; unknown fields or operators are a 400.
export function parseCardQuery(source: SourceKey, params: URLSearchParams): CardQuery | null {
  const where = params.get("where");
  const orderBy = params.get("orderBy");
  const take = params.get("take");
  if (where === null && orderBy === null && take === null) return null;
  let filters: CardFilter[] = [];
  if (where) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(where);
    } catch {
      throw new ApiError(400, "INVALID_FILTER", "Invalid card filters.");
    }
    const result = cardFilterSchema.array().max(10).safeParse(parsed);
    if (!result.success) throw new ApiError(400, "INVALID_FILTER", "Invalid card filters.");
    filters = result.data;
    for (const filter of filters) {
      const def = fieldDef(source, filter.field);
      if (!def?.filterable || !operatorsFor(def.type).includes(filter.op))
        throw new ApiError(400, "INVALID_FILTER", `Can't filter on "${filter.field}" that way.`);
    }
  }
  let sort: CardQuery["sort"];
  if (orderBy) {
    const [field, dir = "asc"] = orderBy.split(":");
    if (!fieldDef(source, field)?.sortable || (dir !== "asc" && dir !== "desc"))
      throw new ApiError(400, "INVALID_SORT", `Can't sort on "${field}".`);
    sort = { field, dir };
  }
  const count = take === null ? 10 : Number(take);
  if (!Number.isInteger(count) || count < 1 || count > MAX_CARD_ROWS)
    throw new ApiError(400, "INVALID_LIMIT", `Show 1 to ${MAX_CARD_ROWS} rows.`);
  return { filters, sort, take: count };
}

export function applyCardQuery(actor: Actor, source: SourceKey, rows: Row[], query: CardQuery, now = new Date()): Row[] {
  let result = rows.filter((row) => query.filters.every((filter) => matches(actor, source, row, filter, now)));
  if (query.sort) {
    const { field, dir } = query.sort;
    const type = fieldDef(source, field)!.type;
    const key = (row: Row) => (canReadField(actor, source, field, row) ? comparable(row[field], type) : null);
    result = [...result].sort((a, b) => {
      const x = key(a);
      const y = key(b);
      if (x === y) return 0;
      // Empty values last, whichever the direction.
      if (x === null) return 1;
      if (y === null) return -1;
      return (x < y ? -1 : 1) * (dir === "asc" ? 1 : -1);
    });
  }
  return result.slice(0, query.take);
}

// Proposals have no list across events; as a main list a card reads the sales
// tracker's proposal rows (FLOW-157), which already apply the viewer's scope.
// The proposals list endpoint answers a card with these (worker/routes/sales/proposals.ts).
export function salesProposals(body: unknown): Row[] {
  const rows = (body as { rows?: Row[] } | null)?.rows ?? [];
  return rows
    .filter((row) => row.kind === "proposal")
    .map((row) => ({
      id: row.id,
      eventId: row.eventId,
      title: row.title,
      stage: row.proposalStage ?? row.stage,
      assignedSalesperson: row.ownerId ? { id: row.ownerId, name: row.owner ?? "" } : null,
      currentVersion: row.versionNumber,
      approvalStatus: row.approvalStatus ?? null,
      updatedAt: row.lastActivity,
    }));
}

export function fieldProjection(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const fields = c.req.query("fields");
    if (c.req.method !== "GET" || fields === undefined) return next();
    const route = fieldRoute(c.req.path);
    if (!route) return next();
    const actor = c.get("actor");
    const parsed = parseFieldList(route.source, fields);
    if ("unknown" in parsed)
      throw new ApiError(400, "UNKNOWN_FIELD", `Unknown field: ${parsed.unknown.join(", ")}.`);
    const card = route.detail ? null : parseCardQuery(route.source, new URL(c.req.url).searchParams);
    const project = (row: Row) => projectRecord(actor, route.source, row, parsed.keys);
    const now = new Date();
    // A card query (FLOW-308): the list endpoint itself runs it, as the viewer,
    // in one query. On the source's main list its filters, sort and limit go
    // into that query's SQL where they can; on other lists (related records,
    // computed sources) the endpoint reads one page. Either way the card is
    // applied again here on what came back, on fields the viewer may read only.
    if (card)
      c.set(
        "card",
        c.req.path === fieldRegistry[route.source].listPath
          ? compileCardSql(actor, route.source, card, now)
          : { orderBy: [], limit: CARD_MEMORY_ROWS },
      );
    await next();
    if (c.res.status !== 200 || !c.res.headers.get("content-type")?.includes("application/json")) return;
    const body = (await c.res.clone().json()) as unknown;
    if (card) {
      const rows = Array.isArray(body) ? (body as Row[]) : [];
      c.res = c.json(applyCardQuery(actor, route.source, rows, card, now).map(project));
      return;
    }
    const headers = new Headers(c.res.headers);
    headers.delete("content-length");
    const projected = Array.isArray(body) ? body.map((row) => project(row as Row)) : project(body as Row);
    c.res = new Response(JSON.stringify(projected), { status: 200, headers });
  };
}
