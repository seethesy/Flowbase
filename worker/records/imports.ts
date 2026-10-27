import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { Actor } from "../../shared/access";
import type {
  ImportField,
  ImportLog,
  ImportModuleInfo,
  ImportRow,
  ImportRowPlan,
  ImportRowResult,
  ImportTransform,
} from "../../shared/imports";
import type { Db, DbLike } from "../db/client";
import { constraintErrors, postgresErrorCode } from "../db/errors";
import { importKeys, importLogs, users } from "../db/schema";
import { ApiError, forbidden, notFound } from "../hono";
import { can, type Action } from "../policy";

// Data import framework (FLOW-47). A module importer describes its fields and row
// transforms (applied in the browser), parses one mapped row, names the row's
// external key, and creates or updates its record. The framework owns the rest:
// the dry-run report, the import log, upserting by external key through
// import_keys (so re-running a file updates instead of duplicating, AC1), and
// committing each batch row by row, where a row that fails is reported and rolled
// back on its own without blocking the others (AC2). Batches are at most 100 rows
// (shared/imports.ts, AC3).

export type ImportContext = { importId: string; fileName: string };
export type ImportDuplicate = { id: string; label: string };

export type ImportModule<Row = unknown> = {
  key: string;
  label: string;
  // Needed to see, check and run this importer.
  permission: Action;
  fields: ImportField[];
  transforms?: ImportTransform[];
  // Validates one mapped row: the parsed row, or what is wrong with it.
  parse: (values: Record<string, string>) => { row: Row } | { errors: string[] };
  // The key a row upserts by, e.g. the item code.
  externalKey: (row: Row) => string;
  // Problems only the database can find (e.g. a section that doesn't exist).
  check?: (
    db: DbLike,
    actor: Actor,
    row: Row,
    recordId: string | null,
  ) => Promise<string[]>;
  // Records a new row may duplicate without sharing its key (e.g. same name).
  findDuplicates?: (
    db: DbLike,
    actor: Actor,
    row: Row,
  ) => Promise<ImportDuplicate[]>;
  // Whether the row would change the record it imported to before; rows that
  // wouldn't are skipped. Without it, every re-imported row updates.
  wouldChange?: (
    db: DbLike,
    actor: Actor,
    recordId: string,
    row: Row,
  ) => Promise<boolean>;
  // Both run inside the row's own savepoint. Throw an ApiError to fail the row.
  create: (
    tx: DbLike,
    actor: Actor,
    row: Row,
    context: ImportContext,
  ) => Promise<string>;
  update: (
    tx: DbLike,
    actor: Actor,
    recordId: string,
    row: Row,
    context: ImportContext,
  ) => Promise<void>;
};

// Keeps each module's row type while the registry holds them side by side.
export const defineImportModule = <Row>(module: ImportModule<Row>) =>
  module as unknown as ImportModule;

// Module importers register here as their tickets land (FLOW-78, FLOW-89,
// FLOW-91, FLOW-99, FLOW-101).
export const importModules: ImportModule[] = [];

const describe = (module: ImportModule): ImportModuleInfo => ({
  key: module.key,
  label: module.label,
  fields: module.fields,
  transforms: module.transforms ?? [],
});

export function listImportModules(
  modules: ImportModule[],
  actor: Actor,
): ImportModuleInfo[] {
  return modules
    .filter((module) => can(actor, module.permission))
    .map(describe);
}

function requireModule(modules: ImportModule[], actor: Actor, key: string) {
  const module = modules.find((candidate) => candidate.key === key);
  if (!module) throw notFound("Importer");
  if (!can(actor, module.permission)) throw forbidden();
  return module;
}

export function getImportModule(
  modules: ImportModule[],
  actor: Actor,
  key: string,
): ImportModuleInfo {
  return describe(requireModule(modules, actor, key));
}

async function linkedRecord(db: DbLike, module: string, externalKey: string) {
  const [link] = await db
    .select()
    .from(importKeys)
    .where(
      and(eq(importKeys.module, module), eq(importKeys.externalKey, externalKey)),
    );
  return link;
}

// The dry run: what committing these rows would do, without writing anything.
export async function planImportRows(
  db: Db,
  modules: ImportModule[],
  actor: Actor,
  moduleKey: string,
  rows: ImportRow[],
): Promise<ImportRowPlan[]> {
  const module = requireModule(modules, actor, moduleKey);
  const plans: ImportRowPlan[] = [];
  for (const row of rows) {
    const parsed = module.parse(row.values);
    const base = { rowNumber: row.rowNumber, duplicates: [] };
    if ("errors" in parsed) {
      plans.push({ ...base, action: "error", externalKey: null, errors: parsed.errors });
      continue;
    }
    const externalKey = module.externalKey(parsed.row);
    const link = await linkedRecord(db, module.key, externalKey);
    const errors =
      (await module.check?.(db, actor, parsed.row, link?.recordId ?? null)) ?? [];
    if (errors.length) {
      plans.push({ ...base, action: "error", externalKey, errors });
      continue;
    }
    if (link) {
      const changes =
        (await module.wouldChange?.(db, actor, link.recordId, parsed.row)) ?? true;
      plans.push({ ...base, action: changes ? "update" : "skip", externalKey, errors });
      continue;
    }
    plans.push({
      ...base,
      action: "create",
      externalKey,
      errors,
      duplicates: (await module.findDuplicates?.(db, actor, parsed.row)) ?? [],
    });
  }
  return plans;
}

type LogRow = typeof importLogs.$inferSelect;
const toLog = (row: LogRow, createdByName: string | null): ImportLog => ({
  id: row.id,
  module: row.module,
  fileName: row.fileName,
  status: row.status,
  rowCount: row.rowCount,
  created: row.created,
  updated: row.updated,
  skipped: row.skipped,
  failed: row.failed,
  createdBy: row.createdBy,
  createdByName,
  createdAt: row.createdAt.toISOString(),
  completedAt: row.completedAt?.toISOString() ?? null,
});

async function readLogs(db: DbLike, where: SQL) {
  const rows = await db
    .select({ log: importLogs, name: users.name, email: users.email })
    .from(importLogs)
    .leftJoin(users, eq(users.id, importLogs.createdBy))
    .where(where)
    .orderBy(desc(importLogs.createdAt))
    .limit(100);
  return rows.map(({ log, name, email }) => toLog(log, name || email || null));
}

async function findLog(
  db: DbLike,
  modules: ImportModule[],
  actor: Actor,
  id: string,
) {
  const [log] = await readLogs(db, eq(importLogs.id, id));
  if (!log) throw notFound("Import");
  return { log, module: requireModule(modules, actor, log.module) };
}

export async function getImport(
  db: Db,
  modules: ImportModule[],
  actor: Actor,
  id: string,
): Promise<ImportLog> {
  return (await findLog(db, modules, actor, id)).log;
}

// Recent imports of the modules the actor can run, newest first.
export async function listImports(
  db: Db,
  modules: ImportModule[],
  actor: Actor,
  moduleKey?: string,
): Promise<ImportLog[]> {
  const keys = listImportModules(modules, actor)
    .map((module) => module.key)
    .filter((key) => !moduleKey || key === moduleKey);
  if (!keys.length) return [];
  return readLogs(db, inArray(importLogs.module, keys));
}

// Logs the import (who, when, which file) before its first batch.
export async function startImport(
  db: Db,
  modules: ImportModule[],
  actor: Actor,
  input: { module: string; fileName: string; rowCount: number },
): Promise<ImportLog> {
  const module = requireModule(modules, actor, input.module);
  const [row] = await db
    .insert(importLogs)
    .values({
      module: module.key,
      fileName: input.fileName,
      rowCount: input.rowCount,
      createdBy: actor.userId,
      updatedBy: actor.userId,
    })
    .returning({ id: importLogs.id });
  return getImport(db, modules, actor, row.id);
}

// A failure that belongs to one row: the importer's own errors and constraint
// violations. Anything else (the database going away) fails the whole batch,
// which rolls back and can be sent again.
function rowError(error: unknown): string | null {
  if (error instanceof ApiError) return error.message;
  const code = postgresErrorCode(error);
  return code && constraintErrors[code] ? constraintErrors[code].message : null;
}

const notRunning = () =>
  new ApiError(409, "IMPORT_FINISHED", "This import is already finished.");

// Commits one batch: each row in its own savepoint, then the log's counts, all
// in one transaction.
export async function importBatch(
  db: Db,
  modules: ImportModule[],
  actor: Actor,
  id: string,
  rows: ImportRow[],
): Promise<{ log: ImportLog; results: ImportRowResult[] }> {
  const { log, module } = await findLog(db, modules, actor, id);
  if (log.status !== "running") throw notRunning();
  const context: ImportContext = { importId: log.id, fileName: log.fileName };
  const results: ImportRowResult[] = [];
  await db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ status: importLogs.status })
      .from(importLogs)
      .where(eq(importLogs.id, id))
      .for("update");
    if (locked.status !== "running") throw notRunning();
    for (const row of rows) {
      const failed = (error: string): ImportRowResult => ({
        rowNumber: row.rowNumber,
        outcome: "failed",
        recordId: null,
        error,
      });
      const parsed = module.parse(row.values);
      if ("errors" in parsed) {
        results.push(failed(parsed.errors.join(" ")));
        continue;
      }
      const externalKey = module.externalKey(parsed.row);
      try {
        results.push(
          await tx.transaction(async (sp): Promise<ImportRowResult> => {
            const link = await linkedRecord(sp, module.key, externalKey);
            const errors =
              (await module.check?.(sp, actor, parsed.row, link?.recordId ?? null)) ??
              [];
            if (errors.length)
              throw new ApiError(400, "INVALID_ROW", errors.join(" "));
            const result = (
              outcome: ImportRowResult["outcome"],
              recordId: string,
            ): ImportRowResult => ({
              rowNumber: row.rowNumber,
              outcome,
              recordId,
              error: null,
            });
            if (link) {
              const changes =
                (await module.wouldChange?.(sp, actor, link.recordId, parsed.row)) ??
                true;
              if (!changes) return result("skipped", link.recordId);
              await module.update(sp, actor, link.recordId, parsed.row, context);
              await sp
                .update(importKeys)
                .set({ importId: log.id, updatedBy: actor.userId })
                .where(eq(importKeys.id, link.id));
              return result("updated", link.recordId);
            }
            const recordId = await module.create(sp, actor, parsed.row, context);
            await sp.insert(importKeys).values({
              module: module.key,
              externalKey,
              recordId,
              importId: log.id,
              createdBy: actor.userId,
              updatedBy: actor.userId,
            });
            return result("created", recordId);
          }),
        );
      } catch (error) {
        const message = rowError(error);
        if (message === null) throw error;
        results.push(failed(message));
      }
    }
    const count = (outcome: ImportRowResult["outcome"]) =>
      results.filter((result) => result.outcome === outcome).length;
    await tx
      .update(importLogs)
      .set({
        created: sql`${importLogs.created} + ${count("created")}`,
        updated: sql`${importLogs.updated} + ${count("updated")}`,
        skipped: sql`${importLogs.skipped} + ${count("skipped")}`,
        failed: sql`${importLogs.failed} + ${count("failed")}`,
        updatedBy: actor.userId,
      })
      .where(eq(importLogs.id, id));
  });
  return { log: await getImport(db, modules, actor, id), results };
}

export async function completeImport(
  db: Db,
  modules: ImportModule[],
  actor: Actor,
  id: string,
): Promise<ImportLog> {
  const { log } = await findLog(db, modules, actor, id);
  if (log.status === "running")
    await db
      .update(importLogs)
      .set({
        status: "completed",
        completedAt: new Date(),
        updatedBy: actor.userId,
      })
      .where(and(eq(importLogs.id, id), eq(importLogs.status, "running")));
  return getImport(db, modules, actor, id);
}
