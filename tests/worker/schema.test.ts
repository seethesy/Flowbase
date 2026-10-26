import { expect, it } from "vitest";
import { is } from "drizzle-orm";
import { PgDialect, PgTable, getTableConfig, pgTable } from "drizzle-orm/pg-core";
import * as schema from "../../worker/db/schema";
import { moneyCents, timestamptz } from "../../worker/db/conventions";

const tables = (Object.values(schema) as unknown[]).filter(
  (value): value is PgTable => is(value, PgTable),
);
type ColumnShape = {
  columnType: string;
  notNull: boolean;
  primary: boolean;
  hasDefault: boolean;
  withTimezone?: boolean;
};
const columnsOf = (table: PgTable) =>
  Object.fromEntries(
    getTableConfig(table).columns.map((c) => [c.name, c as unknown as ColumnShape]),
  );

it("exports the connection check table", () => {
  expect(tables.map((t) => getTableConfig(t).name)).toContain(
    "connection_checks",
  );
});
for (const table of tables) {
  const { name } = getTableConfig(table);
  it(`${name} enables RLS and follows the base column conventions`, () => {
    expect(getTableConfig(table).enableRLS).toBe(true);
    const columns = columnsOf(table);
    expect(columns.id).toMatchObject({
      columnType: "PgUUID",
      primary: true,
      hasDefault: true,
    });
    for (const column of ["created_at", "updated_at", "archived_at"])
      expect(columns[column]).toMatchObject({
        columnType: "PgTimestamp",
        withTimezone: true,
      });
    expect(columns.created_at.notNull).toBe(true);
    expect(columns.updated_at.notNull).toBe(true);
    expect(columns.archived_at.notNull).toBe(false);
    for (const column of ["created_by", "updated_by"])
      expect(columns[column]).toMatchObject({
        columnType: "PgUUID",
        notNull: false,
      });
  });
}
it("provides timestamptz and integer-cent column helpers", () => {
  const sample = columnsOf(
    pgTable("sample", {
      at: timestamptz("at"),
      total: moneyCents("total_cents").notNull(),
    }),
  );
  expect(sample.at).toMatchObject({
    columnType: "PgTimestamp",
    withTimezone: true,
  });
  expect(sample.total_cents).toMatchObject({
    columnType: "PgInteger",
    notNull: true,
  });
});

// FLOW-187: every enum-like text column has a CHECK constraint listing exactly its
// enum values, so a new value can't be added in code without the database knowing.
const dialect = new PgDialect();
for (const table of tables) {
  const { name, columns, checks } = getTableConfig(table);
  for (const column of columns.filter((c) => c.enumValues?.length)) {
    it(`${name}.${column.name} has a CHECK constraint for its enum values`, () => {
      const constraint = checks.find((c) => c.name === `${name}_${column.name}_check`);
      expect(constraint).toBeDefined();
      const text = dialect.sqlToQuery(constraint!.value).sql;
      const listed = [...text.matchAll(/'([^']*)'/g)].map((m) => m[1]);
      expect(listed).toEqual(column.enumValues);
    });
  }
}
