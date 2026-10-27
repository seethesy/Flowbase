import { and, asc, desc, or, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { ApiError } from "../hono";

// Cursor paging for list endpoints (FLOW-179). A page is the next `limit` rows in
// the list's own order after the cursor; the cursor is the last row's sort values,
// so paging returns every matching row exactly once even while rows are added.
// Every key list ends with the id, which makes the order total.
export type PageRequest = { cursor?: string; limit?: number };
export type Page<T> = { rows: T[]; next: string | null };

export const DEFAULT_PAGE_SIZE = 100;
export const MAX_PAGE_SIZE = 500;

type KeyType = "timestamp" | "text" | "uuid" | "number";
export type SortKey<R> = {
  column: AnyColumn | SQL;
  type: KeyType;
  desc?: boolean;
  of: (row: R) => Date | string | number;
};

const casts: Record<KeyType, string> = {
  timestamp: "timestamptz",
  text: "text",
  uuid: "uuid",
  number: "numeric",
};

// Postgres keeps microseconds and JavaScript dates only milliseconds, so time keys
// sort and compare at millisecond precision; otherwise a cursor could skip rows.
const expression = (key: SortKey<never>) =>
  key.type === "timestamp"
    ? sql`date_trunc('milliseconds', ${key.column})`
    : sql`${key.column}`;

const invalidCursor = () =>
  new ApiError(
    400,
    "INVALID_REQUEST",
    "That page of results is no longer valid. Reload the list.",
  );

function encode(values: (Date | string | number)[]) {
  const json = JSON.stringify(
    values.map((value) => (value instanceof Date ? value.toISOString() : value)),
  );
  return btoa(String.fromCharCode(...new TextEncoder().encode(json)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function decode(cursor: string, keys: SortKey<never>[]): (string | number)[] {
  let values: unknown;
  try {
    const base64 = cursor.replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    values = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw invalidCursor();
  }
  if (!Array.isArray(values) || values.length !== keys.length) throw invalidCursor();
  values.forEach((value, i) => {
    const type = keys[i].type;
    const ok =
      type === "number"
        ? typeof value === "number" && Number.isFinite(value)
        : typeof value === "string" &&
          (type !== "timestamp" || !Number.isNaN(Date.parse(value)));
    if (!ok) throw invalidCursor();
  });
  return values as (string | number)[];
}

// Rows strictly after the cursor in this key order (lexicographic, per-key
// direction).
function after(keys: SortKey<never>[], values: (string | number)[]): SQL {
  const value = (i: number) =>
    sql`${values[i]}::${sql.raw(casts[keys[i].type])}`;
  const branches = keys.map((key, i) => {
    const equalBefore = keys
      .slice(0, i)
      .map((earlier, j) => sql`${expression(earlier)} = ${value(j)}`);
    const step = key.desc
      ? sql`${expression(key)} < ${value(i)}`
      : sql`${expression(key)} > ${value(i)}`;
    return and(...equalBefore, step) as SQL;
  });
  return or(...branches) as SQL;
}

export function pageSize(limit?: number) {
  if (limit === undefined) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.max(1, Math.floor(limit)), MAX_PAGE_SIZE);
}

// Everything a list query needs for one page: the cursor condition to add to its
// where clause, the order, the row limit (one extra row tells whether more exist)
// and `page` to cut the rows and build the next cursor.
export function keyset<R>(keys: SortKey<R>[], request: PageRequest = {}) {
  const limit = pageSize(request.limit);
  const plain = keys as SortKey<never>[];
  return {
    where: request.cursor ? after(plain, decode(request.cursor, plain)) : undefined,
    orderBy: plain.map((key) =>
      key.desc ? desc(expression(key)) : asc(expression(key)),
    ),
    limit: limit + 1,
    page<T = R>(rows: R[], map?: (rows: R[]) => T[] | Promise<T[]>) {
      const more = rows.length > limit;
      const kept = rows.slice(0, limit);
      const last = kept[kept.length - 1];
      const next = more && last ? encode(keys.map((key) => key.of(last))) : null;
      const finish = (mapped: T[]): Page<T> => ({ rows: mapped, next });
      if (!map) return Promise.resolve(finish(kept as unknown as T[]));
      return Promise.resolve(map(kept)).then(finish);
    },
  };
}
