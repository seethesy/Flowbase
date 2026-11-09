import { and, asc, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { Actor } from "../../shared/access";
import {
  describeRegeneration,
  planRegeneration,
  type RegenRow,
  type RegeneratePreview,
} from "../../shared/planning";
import {
  kitchenValueLabel,
  kitchenValueSummary,
  sameKitchenValue,
  type KitchenLine,
  type KitchenLineInput,
  type KitchenLineUpdate,
  type KitchenLineValue,
  type KitchenMenu,
} from "../../shared/kitchen-menu";
import { mayEditKitchenMenu } from "../../shared/policy";
import { businessTimeToUtc, utcToBusinessTime } from "../../shared/time";
import { convert, type Unit } from "../../shared/units";
import { writeAudit, writeAuditMany } from "../audit/log";
import type { Db, DbLike } from "../db/client";
import {
  kitchenMenuLines,
  kitchenMenus,
  events,
  inventoryItems,
  inventoryConsumableDetails,
  recipes,
  taskAssignees,
  tasks,
  users,
} from "../db/schema";
import { ApiError, notFound } from "../hono";
import { findVisibleEvent } from "./events";
import { eventProposalLines } from "./pull-list";
import { replaceRequirements, requestEventRecompute } from "./allocations";
import { scaleRecipeFor } from "./recipes";

// The kitchen menu (FLOW-137): the dishes for one event, generated from the mapped
// proposal and planned by the Kitchen Lead. Prep is handed out as kitchen tasks
// linked to the event (the existing tasks module).

type LineRow = typeof kitchenMenuLines.$inferSelect;

const forbidden = () => new ApiError(403, "FORBIDDEN", "You don't have access to this.");

const toValue = (row: LineRow, name: string): KitchenLineValue => ({
  recipeId: row.recipeId,
  name,
  course: row.course,
  plannedQuantity: row.plannedQuantity,
  notes: row.notes,
});

// One entry per menu line of the proposal that is matched to a dish.
export async function generatedKitchenLines(db: DbLike, eventId: string) {
  const [event] = await db.select({ guests: events.guestCount, servings: events.servingsCount })
    .from(events).where(eq(events.id, eventId));
  const lines = ((await eventProposalLines(db, eventId)) ?? []).filter(
    (line) => line.kind === "menu" && line.catalogId && !line.notTracked,
  );
  if (!lines.length) return [];
  const found = await db
    .select({ id: recipes.id, name: recipes.name, category: recipes.category })
    .from(recipes)
    .where(inArray(recipes.id, lines.map((line) => line.catalogId!)));
  const byId = new Map(found.map((recipe) => [recipe.id, recipe]));
  return lines.flatMap((line) => {
    const recipe = byId.get(line.catalogId!);
    if (!recipe) return [];
    return [
      {
        sourceKey: `line:${line.id}`,
        value: {
          recipeId: recipe.id,
          name: recipe.name,
          course: line.section.trim() || recipe.category,
          plannedQuantity: event?.servings ?? event?.guests ?? null,
          notes: line.notes,
        } satisfies KitchenLineValue,
      },
    ];
  });
}

// Menu requirements are a single source-scoped set. Scaling uses the recipe's
// purchase units, exactly as the recipe scaling screen does. A dish without a
// yield stays on the kitchen menu but contributes no inventory requirement.
async function syncKitchenRequirements(tx: DbLike, actor: Actor | null, eventId: string) {
  const rows = await tx.select({ recipeId: kitchenMenuLines.recipeId, quantity: kitchenMenuLines.plannedQuantity })
    .from(kitchenMenuLines)
    .innerJoin(kitchenMenus, eq(kitchenMenus.id, kitchenMenuLines.menuId))
    .where(and(eq(kitchenMenus.eventId, eventId), isNull(kitchenMenuLines.archivedAt)));
  const purchase = new Map<string, { quantity: number; unit: Unit }>();
  for (const row of rows) {
    if (row.quantity === null || row.quantity === 0) continue;
    const scaled = await scaleRecipeFor(tx, row.recipeId, row.quantity);
    if (!scaled.ok) continue;
    for (const line of scaled.totals) {
      const current = purchase.get(line.itemId);
      purchase.set(line.itemId, { quantity: Math.round(((current?.quantity ?? 0) + line.quantity) * 10_000) / 10_000, unit: line.unit });
    }
  }
  const details = purchase.size ? await tx.select({ id: inventoryItems.id, unit: inventoryItems.unit,
    packCount: inventoryConsumableDetails.packCount,
    eachSizeQuantity: inventoryConsumableDetails.eachSizeQuantity,
    eachSizeUnit: inventoryConsumableDetails.eachSizeUnit,
  }).from(inventoryItems)
    .innerJoin(inventoryConsumableDetails, eq(inventoryConsumableDetails.itemId, inventoryItems.id))
    .where(inArray(inventoryItems.id, [...purchase.keys()])) : [];
  const totals = new Map<string, number>();
  for (const item of details) {
    const need = purchase.get(item.id)!;
    const converted = convert(need.quantity, need.unit, item.unit as Unit, {
      packCount: item.packCount,
      eachSize: item.eachSizeQuantity !== null && item.eachSizeUnit
        ? { quantity: item.eachSizeQuantity, unit: item.eachSizeUnit as Unit } : null,
    });
    if (converted.ok) totals.set(item.id, Math.round(converted.value * 10_000) / 10_000);
  }
  await replaceRequirements(tx, actor, eventId, "menu", [...totals].map(([itemId, quantity]) => ({ itemId, quantity, basis: "fixed" })));
  await requestEventRecompute(tx, eventId);
}

async function generatedRows(db: DbLike, menuId: string) {
  const rows = await db
    .select({ line: kitchenMenuLines, name: recipes.name })
    .from(kitchenMenuLines)
    .innerJoin(recipes, eq(recipes.id, kitchenMenuLines.recipeId))
    .where(and(eq(kitchenMenuLines.menuId, menuId), isNotNull(kitchenMenuLines.sourceKey)));
  return rows.map(
    ({ line, name }): RegenRow<KitchenLineValue> => ({
      id: line.id,
      sourceKey: line.sourceKey!,
      edited: line.edited,
      removed: line.archivedAt !== null,
      value: toValue(line, name),
    }),
  );
}

async function planFor(db: DbLike, eventId: string, discardEdits: boolean) {
  const generated = await generatedKitchenLines(db, eventId);
  const [menu] = await db.select().from(kitchenMenus).where(eq(kitchenMenus.eventId, eventId));
  const existing = menu ? await generatedRows(db, menu.id) : [];
  return planRegeneration(existing, generated, sameKitchenValue, discardEdits);
}

export async function previewKitchenRegeneration(
  db: Db,
  actor: Actor,
  eventId: string,
  discardEdits: boolean,
): Promise<RegeneratePreview> {
  await findVisibleEvent(db, actor, eventId);
  return describeRegeneration(
    await planFor(db, eventId, discardEdits),
    kitchenValueLabel,
    kitchenValueSummary,
  );
}

async function ensureMenu(tx: DbLike, actor: Actor | null, eventId: string) {
  const by = actor?.userId ?? null;
  await tx
    .insert(kitchenMenus)
    .values({ eventId, createdBy: by, updatedBy: by })
    .onConflictDoNothing({ target: kitchenMenus.eventId });
  const [menu] = await tx.select().from(kitchenMenus).where(eq(kitchenMenus.eventId, eventId));
  return menu;
}

const snapshot = (row: LineRow, name: string) => ({
  recipe: name,
  course: row.course,
  plannedQuantity: row.plannedQuantity,
  notes: row.notes,
  removed: row.archivedAt !== null,
});

export type KitchenGenerationSummary = { added: number; changed: number; removed: number; kept: number };

// Builds or rebuilds the menu inside the caller's transaction. Safe to repeat.
export async function generateKitchenMenu(
  tx: DbLike,
  actor: Actor | null,
  eventId: string,
  discardEdits = false,
): Promise<KitchenGenerationSummary> {
  const menu = await ensureMenu(tx, actor, eventId);
  const generated = await generatedKitchenLines(tx, eventId);
  const plan = planRegeneration(
    await generatedRows(tx, menu.id),
    generated,
    sameKitchenValue,
    discardEdits,
  );
  const by = actor?.userId ?? null;
  const now = new Date();
  const audits: Parameters<typeof writeAuditMany>[2] = [];
  const set = (value: KitchenLineValue) => ({
    recipeId: value.recipeId,
    course: value.course,
    plannedQuantity: value.plannedQuantity,
    notes: value.notes,
  });

  for (const line of plan.add) {
    const [row] = await tx
      .insert(kitchenMenuLines)
      .values({
        menuId: menu.id,
        ...set(line.value),
        sourceKey: line.sourceKey,
        createdBy: by,
        updatedBy: by,
      })
      .returning();
    audits.push({
      entityType: "kitchen_menu_line",
      entityId: row.id,
      action: "create",
      before: null,
      after: snapshot(row, line.value.name),
    });
  }
  for (const line of plan.update) {
    const [row] = await tx
      .update(kitchenMenuLines)
      .set({ ...set(line.value), archivedAt: null, edited: false, updatedBy: by })
      .where(eq(kitchenMenuLines.id, line.id))
      .returning();
    audits.push({
      entityType: "kitchen_menu_line",
      entityId: row.id,
      action: "update",
      before: {
        recipe: line.before.name,
        course: line.before.course,
        plannedQuantity: line.before.plannedQuantity,
        notes: line.before.notes,
        removed: line.restore,
      },
      after: snapshot(row, line.value.name),
    });
  }
  for (const line of plan.remove) {
    const [row] = await tx
      .update(kitchenMenuLines)
      .set({ archivedAt: now, sourceKey: null, updatedBy: by })
      .where(eq(kitchenMenuLines.id, line.id))
      .returning();
    audits.push({
      entityType: "kitchen_menu_line",
      entityId: row.id,
      action: "archive",
      before: snapshot({ ...row, archivedAt: null }, line.before.name),
      after: snapshot(row, line.before.name),
    });
  }
  await writeAuditMany(tx, actor, audits);
  await tx.update(kitchenMenus).set({ generatedAt: now, updatedBy: by }).where(eq(kitchenMenus.id, menu.id));
  await syncKitchenRequirements(tx, actor, eventId);
  return {
    added: plan.add.length,
    changed: plan.update.length,
    removed: plan.remove.length,
    kept: plan.kept.length,
  };
}

export async function regenerateKitchenMenu(
  db: Db,
  actor: Actor,
  eventId: string,
  discardEdits: boolean,
) {
  if (!mayEditKitchenMenu(actor)) throw forbidden();
  await findVisibleEvent(db, actor, eventId);
  await db.transaction((tx) => generateKitchenMenu(tx, actor, eventId, discardEdits));
  return getKitchenMenu(db, actor, eventId);
}

// --- Reading --------------------------------------------------------------------

export async function getKitchenMenu(db: Db, actor: Actor, eventId: string): Promise<KitchenMenu> {
  const event = await findVisibleEvent(db, actor, eventId);
  const canEdit = mayEditKitchenMenu(actor);
  // The Kitchen Lead and managers hand out prep tasks.
  const canAssign = canEdit;
  const [menu] = await db.select().from(kitchenMenus).where(eq(kitchenMenus.eventId, eventId));

  const taskRows = await db
    .select({ id: tasks.id, title: tasks.title, status: tasks.status })
    .from(tasks)
    .where(and(eq(tasks.eventId, eventId), eq(tasks.type, "kitchen"), isNull(tasks.archivedAt)))
    .orderBy(desc(tasks.createdAt));
  const assignees = taskRows.length
    ? await db
        .select({ taskId: taskAssignees.taskId, id: users.id, name: users.name })
        .from(taskAssignees)
        .innerJoin(users, eq(users.id, taskAssignees.userId))
        .where(
          and(
            inArray(taskAssignees.taskId, taskRows.map((task) => task.id)),
            isNull(taskAssignees.archivedAt),
          ),
        )
    : [];
  const kitchenTasks = taskRows.map((task) => ({
    id: task.id,
    title: task.title,
    status: task.status,
    assignees: assignees
      .filter((row) => row.taskId === task.id)
      .map((row) => ({ id: row.id, name: row.name })),
  }));

  const leaves = menu?.leavesKitchenAt ?? null;
  const base = {
    eventId,
    servings: event.servingsCount ?? event.guestCount ?? null,
    leavesKitchenAt: leaves?.toISOString() ?? null,
    leavesKitchenTime: leaves ? utcToBusinessTime(leaves).time : null,
    venueArrivalAt: event.arrivesAt?.toISOString() ?? null,
    tasks: kitchenTasks,
    canEdit,
    canAssign,
  };
  if (!menu) return { ...base, exists: false, courses: [], generatedAt: null };

  const rows = await db
    .select({ line: kitchenMenuLines, recipe: recipes })
    .from(kitchenMenuLines)
    .innerJoin(recipes, eq(recipes.id, kitchenMenuLines.recipeId))
    .where(and(eq(kitchenMenuLines.menuId, menu.id), isNull(kitchenMenuLines.archivedAt)))
    .orderBy(asc(kitchenMenuLines.course), asc(kitchenMenuLines.createdAt));
  const courses: KitchenMenu["courses"] = [];
  for (const { line, recipe } of rows) {
    const entry: KitchenLine = {
      id: line.id,
      recipeId: recipe.id,
      name: recipe.name,
      course: line.course,
      plannedQuantity: line.plannedQuantity,
      tbd: line.plannedQuantity === null,
      notes: line.notes,
      allergens: recipe.allergens,
      dietaryTags: recipe.dietaryTags,
      scalable: recipe.yieldServings !== null && recipe.yieldServings > 0,
      generated: line.sourceKey !== null,
      edited: line.edited,
    };
    const course = courses.find((group) => group.course === line.course);
    if (course) course.lines.push(entry);
    else courses.push({ course: line.course, lines: [entry] });
  }
  return { ...base, exists: true, courses, generatedAt: menu.generatedAt?.toISOString() ?? null };
}

// --- Editing --------------------------------------------------------------------

async function findLine(tx: DbLike, eventId: string, lineId: string) {
  const [row] = await tx
    .select({ line: kitchenMenuLines, name: recipes.name })
    .from(kitchenMenuLines)
    .innerJoin(kitchenMenus, eq(kitchenMenus.id, kitchenMenuLines.menuId))
    .innerJoin(recipes, eq(recipes.id, kitchenMenuLines.recipeId))
    .where(
      and(
        eq(kitchenMenuLines.id, lineId),
        eq(kitchenMenus.eventId, eventId),
        isNull(kitchenMenuLines.archivedAt),
      ),
    )
    .for("update", { of: kitchenMenuLines });
  if (!row) throw notFound("Menu line");
  return row;
}

export async function addKitchenLine(db: Db, actor: Actor, eventId: string, input: KitchenLineInput) {
  if (!mayEditKitchenMenu(actor)) throw forbidden();
  await findVisibleEvent(db, actor, eventId);
  await db.transaction(async (tx) => {
    const [event] = await tx.select({ guests: events.guestCount, servings: events.servingsCount })
      .from(events).where(eq(events.id, eventId));
    const [recipe] = await tx
      .select({ id: recipes.id, name: recipes.name, category: recipes.category })
      .from(recipes)
      .where(and(eq(recipes.id, input.recipeId), eq(recipes.active, true), isNull(recipes.archivedAt)));
    if (!recipe) throw new ApiError(400, "INVALID_REQUEST", "Choose a dish that exists.");
    const menu = await ensureMenu(tx, actor, eventId);
    const [row] = await tx
      .insert(kitchenMenuLines)
      .values({
        menuId: menu.id,
        recipeId: recipe.id,
        course: (input.course ?? "").trim() || recipe.category,
        plannedQuantity: input.plannedQuantity === undefined
          ? (event?.servings ?? event?.guests ?? null)
          : input.plannedQuantity,
        notes: input.notes ?? "",
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .returning();
    await writeAudit(tx, actor, {
      entityType: "kitchen_menu_line",
      entityId: row.id,
      action: "create",
      before: null,
      after: snapshot(row, recipe.name),
    });
    await syncKitchenRequirements(tx, actor, eventId);
  });
  return getKitchenMenu(db, actor, eventId);
}

export async function updateKitchenLine(
  db: Db,
  actor: Actor,
  eventId: string,
  lineId: string,
  input: KitchenLineUpdate,
) {
  if (!mayEditKitchenMenu(actor)) throw forbidden();
  await findVisibleEvent(db, actor, eventId);
  await db.transaction(async (tx) => {
    const { line: before, name } = await findLine(tx, eventId, lineId);
    const [row] = await tx
      .update(kitchenMenuLines)
      .set({ ...input, edited: before.sourceKey !== null ? true : before.edited, updatedBy: actor.userId })
      .where(eq(kitchenMenuLines.id, lineId))
      .returning();
    await writeAudit(tx, actor, {
      entityType: "kitchen_menu_line",
      entityId: lineId,
      action: "update",
      before: snapshot(before, name),
      after: snapshot(row, name),
    });
    await syncKitchenRequirements(tx, actor, eventId);
  });
  return getKitchenMenu(db, actor, eventId);
}

export async function removeKitchenLine(db: Db, actor: Actor, eventId: string, lineId: string) {
  if (!mayEditKitchenMenu(actor)) throw forbidden();
  await findVisibleEvent(db, actor, eventId);
  await db.transaction(async (tx) => {
    const { line: before, name } = await findLine(tx, eventId, lineId);
    const [row] = await tx
      .update(kitchenMenuLines)
      .set({ archivedAt: new Date(), updatedBy: actor.userId })
      .where(eq(kitchenMenuLines.id, lineId))
      .returning();
    await writeAudit(tx, actor, {
      entityType: "kitchen_menu_line",
      entityId: lineId,
      action: "archive",
      before: snapshot(before, name),
      after: snapshot(row, name),
    });
    await syncKitchenRequirements(tx, actor, eventId);
  });
  return getKitchenMenu(db, actor, eventId);
}

// The time food leaves the kitchen, on the event date in New York time (AC2).
export async function setLeavesKitchen(
  db: Db,
  actor: Actor,
  eventId: string,
  time: string | null,
) {
  if (!mayEditKitchenMenu(actor)) throw forbidden();
  const event = await findVisibleEvent(db, actor, eventId);
  await db.transaction(async (tx) => {
    let leavesKitchenAt: Date | null = null;
    if (time !== null) {
      try {
        leavesKitchenAt = businessTimeToUtc(utcToBusinessTime(event.startsAt).date, time);
      } catch {
        throw new ApiError(400, "INVALID_REQUEST", "That time doesn't exist on the event date.");
      }
    }
    const menu = await ensureMenu(tx, actor, eventId);
    const [row] = await tx
      .update(kitchenMenus)
      .set({ leavesKitchenAt, updatedBy: actor.userId })
      .where(eq(kitchenMenus.id, menu.id))
      .returning();
    await writeAudit(tx, actor, {
      entityType: "kitchen_menu",
      entityId: menu.id,
      action: "update",
      before: { leavesKitchenAt: menu.leavesKitchenAt?.toISOString() ?? null },
      after: { leavesKitchenAt: row.leavesKitchenAt?.toISOString() ?? null },
    });
  });
  return getKitchenMenu(db, actor, eventId);
}
