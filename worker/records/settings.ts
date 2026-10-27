import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Actor } from "../../shared/access";
import {
  defaultBusinessDefaults,
  defaultCompanyProfile,
  listKeys,
  listLabels,
  settingSchemas,
  type BusinessSettings,
  type ListKey,
  type ListValue,
  type SettingKey,
  type SettingsHistoryEntry,
} from "../../shared/settings";
import { writeAudit } from "../audit/log";
import type { Db, DbLike } from "../db/client";
import { auditLog, listValues, settings, users } from "../db/schema";
import { ApiError, notFound } from "../hono";
import { setArchived } from "./archive";

// Business settings and configurable lists (FLOW-45). Everyone signed in reads them
// (forms need the lists); routes limit writes to Admin. Every write is audited.

const defaults: { [K in SettingKey]: BusinessSettings[K] } = {
  company: defaultCompanyProfile,
  defaults: defaultBusinessDefaults,
};

// A stored value the current schema no longer accepts falls back to the defaults
// rather than breaking every screen; new fields take their defaults.
function parseSetting<K extends SettingKey>(
  key: K,
  value: unknown,
): BusinessSettings[K] {
  const parsed = settingSchemas[key].safeParse(value);
  return (parsed.success ? parsed.data : defaults[key]) as BusinessSettings[K];
}

const toListValue = (row: typeof listValues.$inferSelect): ListValue => ({
  id: row.id,
  listKey: row.listKey,
  label: row.label,
  sortOrder: row.sortOrder,
  archived: row.archivedAt !== null,
});

export async function getSettings(db: DbLike): Promise<BusinessSettings> {
  const rows = await db.select().from(settings);
  const values = await db
    .select()
    .from(listValues)
    .orderBy(asc(listValues.sortOrder), asc(listValues.label));
  const stored = new Map(rows.map((row) => [row.key, row.value]));
  const lists = Object.fromEntries(
    listKeys.map((key) => [key, [] as ListValue[]]),
  ) as Record<ListKey, ListValue[]>;
  for (const row of values) lists[row.listKey].push(toListValue(row));
  return {
    company: parseSetting("company", stored.get("company")),
    defaults: parseSetting("defaults", stored.get("defaults")),
    lists,
  };
}

// The audit snapshot of a settings group. A logo is stored as an inline image; the
// audit records that it changed, not the image itself.
function settingSnapshot(value: Record<string, unknown>) {
  const logo = value.logo;
  return typeof logo === "string"
    ? { ...value, logo: `image (${logo.length} characters, ends ${logo.slice(-8)})` }
    : value;
}

export async function updateSetting<K extends SettingKey>(
  db: Db,
  actor: Actor,
  key: K,
  value: BusinessSettings[K],
): Promise<BusinessSettings[K]> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(settings)
      .where(eq(settings.key, key))
      .for("update");
    const before = current ? parseSetting(key, current.value) : defaults[key];
    const [row] = current
      ? await tx
          .update(settings)
          .set({ value, updatedBy: actor.userId })
          .where(eq(settings.id, current.id))
          .returning()
      : await tx
          .insert(settings)
          .values({
            key,
            value,
            createdBy: actor.userId,
            updatedBy: actor.userId,
          })
          .returning();
    await writeAudit(tx, actor, {
      entityType: "setting",
      entityId: row.id,
      action: current ? "update" : "create",
      before: settingSnapshot({ key, ...before }),
      after: settingSnapshot({ key, ...value }),
    });
    return value;
  });
}

const listValueSnapshot = async (tx: DbLike, id: string) => {
  const [row] = await tx.select().from(listValues).where(eq(listValues.id, id));
  if (!row) throw notFound("List value");
  return toListValue(row);
};

async function assertUniqueLabel(
  tx: DbLike,
  key: ListKey,
  label: string,
  exceptId?: string,
) {
  const [taken] = await tx
    .select({ id: listValues.id })
    .from(listValues)
    .where(
      and(
        eq(listValues.listKey, key),
        isNull(listValues.archivedAt),
        sql`lower(${listValues.label}) = ${label.toLowerCase()}`,
      ),
    );
  if (taken && taken.id !== exceptId)
    throw new ApiError(
      409,
      "ALREADY_EXISTS",
      `"${label}" is already in ${listLabels[key]}.`,
    );
}

export async function addListValue(
  db: Db,
  actor: Actor,
  key: ListKey,
  label: string,
): Promise<ListValue> {
  return db.transaction(async (tx) => {
    await assertUniqueLabel(tx, key, label);
    const [{ next }] = await tx
      .select({
        next: sql<number>`coalesce(max(${listValues.sortOrder}) + 1, 0)::int`,
      })
      .from(listValues)
      .where(eq(listValues.listKey, key));
    const [row] = await tx
      .insert(listValues)
      .values({
        listKey: key,
        label,
        sortOrder: next,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .returning();
    const value = toListValue(row);
    await writeAudit(tx, actor, {
      entityType: "list_value",
      entityId: row.id,
      action: "create",
      before: null,
      after: value,
    });
    return value;
  });
}

// Renaming changes what new records get; existing records keep the old label.
export async function renameListValue(
  db: Db,
  actor: Actor,
  id: string,
  label: string,
): Promise<ListValue> {
  return db.transaction(async (tx) => {
    const before = await listValueSnapshot(tx, id);
    if (!before.archived) await assertUniqueLabel(tx, before.listKey, label, id);
    await tx
      .update(listValues)
      .set({ label, updatedBy: actor.userId })
      .where(eq(listValues.id, id));
    const after = await listValueSnapshot(tx, id);
    await writeAudit(tx, actor, {
      entityType: "list_value",
      entityId: id,
      action: "update",
      before,
      after,
    });
    return after;
  });
}

// Sets the display order of a list: ids in the order to show them. Values left
// out keep their position after the ones given.
export async function orderListValues(
  db: Db,
  actor: Actor,
  key: ListKey,
  ids: string[],
): Promise<ListValue[]> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(listValues)
      .where(eq(listValues.listKey, key))
      .orderBy(asc(listValues.sortOrder), asc(listValues.label))
      .for("update");
    const known = new Set(rows.map((row) => row.id));
    if (new Set(ids).size !== ids.length || ids.some((id) => !known.has(id)))
      throw new ApiError(
        400,
        "INVALID_REQUEST",
        `Every value must belong to ${listLabels[key]}, once.`,
      );
    const ordered = [
      ...ids,
      ...rows.map((row) => row.id).filter((id) => !ids.includes(id)),
    ];
    for (const [sortOrder, id] of ordered.entries()) {
      const row = rows.find((candidate) => candidate.id === id)!;
      if (row.sortOrder === sortOrder) continue;
      const before = toListValue(row);
      await tx
        .update(listValues)
        .set({ sortOrder, updatedBy: actor.userId })
        .where(eq(listValues.id, id));
      await writeAudit(tx, actor, {
        entityType: "list_value",
        entityId: id,
        action: "update",
        before,
        after: { ...before, sortOrder },
      });
    }
    return (await getSettings(tx)).lists[key];
  });
}

export async function setListValueArchived(
  db: Db,
  actor: Actor,
  id: string,
  archived: boolean,
): Promise<ListValue> {
  const current = await listValueSnapshot(db, id);
  if (!archived && current.archived)
    await assertUniqueLabel(db, current.listKey, current.label, id);
  await setArchived(db, actor, id, archived, {
    update: (tx, values) =>
      tx.update(listValues).set(values).where(eq(listValues.id, id)),
    audit: { entityType: "list_value", snapshot: listValueSnapshot },
  });
  return listValueSnapshot(db, id);
}

// Values a record may newly take from a list: active ones. Values the record
// already had are kept even when archived since.
export async function assertListLabels(
  tx: DbLike,
  key: ListKey,
  labels: readonly string[],
  kept: readonly string[] = [],
) {
  const added = labels.filter((label) => !kept.includes(label));
  if (!added.length) return;
  const active = await tx
    .select({ label: listValues.label })
    .from(listValues)
    .where(
      and(
        eq(listValues.listKey, key),
        isNull(listValues.archivedAt),
        inArray(listValues.label, added),
      ),
    );
  const allowed = new Set(active.map((row) => row.label));
  const missing = added.find((label) => !allowed.has(label));
  if (missing)
    throw new ApiError(
      400,
      "INVALID_VALUE",
      `"${missing}" isn't an active value in ${listLabels[key]}.`,
    );
}


// Recent changes to settings and lists, newest first, for the Settings screen.
export async function settingsHistory(
  db: DbLike,
  limit = 100,
): Promise<SettingsHistoryEntry[]> {
  const rows = await db
    .select({
      entry: auditLog,
      actorName: users.name,
      actorEmail: users.email,
      settingKey: settings.key,
      listKey: listValues.listKey,
      label: listValues.label,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.createdBy))
    .leftJoin(settings, eq(settings.id, auditLog.entityId))
    .leftJoin(listValues, eq(listValues.id, auditLog.entityId))
    .where(inArray(auditLog.entityType, ["setting", "list_value"]))
    .orderBy(desc(auditLog.createdAt))
    .limit(limit);
  return rows.map(({ entry, actorName, actorEmail, settingKey, listKey, label }) => ({
    id: entry.id,
    entityType: entry.entityType as "setting" | "list_value",
    entityId: entry.entityId,
    subject:
      entry.entityType === "setting"
        ? settingKey === "company"
          ? "Company profile"
          : "Defaults"
        : listKey
          ? `${listLabels[listKey]}: ${label}`
          : "List value",
    action: entry.action,
    actorId: entry.createdBy,
    actorName: actorName || actorEmail || null,
    at: entry.createdAt.toISOString(),
    changes: entry.changes,
  }));
}
