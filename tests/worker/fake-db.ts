import { getTableName, type Table } from "drizzle-orm";
import type { Db } from "../../worker/db/client";
import type { RunWithDb } from "../../worker/hono";

// A recording stand-in for the database (FLOW-305/306): every select, insert,
// update and transaction is logged with its table, and selects answer the rows
// given per table name. Enough for middleware and route plumbing, not for SQL.
export type Statement = { kind: "select" | "insert" | "update" | "delete" | "transaction"; table?: string };

export function fakeDb(rows: Record<string, unknown[]> = {}) {
  const statements: Statement[] = [];
  const chain = (statement: Statement, result: () => unknown[]) => {
    const builder: Record<string | symbol, unknown> = {};
    const self = new Proxy(builder, {
      get(_target, key) {
        if (key === "then")
          return (resolve: (value: unknown) => void, reject: (error: unknown) => void) =>
            Promise.resolve(result()).then(resolve, reject);
        if (key === "from")
          return (table: Table) => {
            statement.table = getTableName(table);
            return self;
          };
        return () => self;
      },
    });
    statements.push(statement);
    return self;
  };
  const db: Record<string, unknown> = {
    select: () => {
      const statement: Statement = { kind: "select" };
      return chain(statement, () => (statement.table ? rows[statement.table] ?? [] : []));
    },
    insert: (table: Table) => chain({ kind: "insert", table: getTableName(table) }, () => []),
    update: (table: Table) => chain({ kind: "update", table: getTableName(table) }, () => []),
    delete: (table: Table) => chain({ kind: "delete", table: getTableName(table) }, () => []),
    execute: () => Promise.resolve([]),
    transaction: async (run: (tx: unknown) => Promise<unknown>) => {
      statements.push({ kind: "transaction" });
      return run(db);
    },
  };
  let connections = 0;
  const withDb: RunWithDb = (_env, run) => {
    connections++;
    return run(db as unknown as Db);
  };
  return {
    db: db as unknown as Db,
    withDb,
    statements,
    get connections() {
      return connections;
    },
  };
}
