// Recipes and kitchen menus.
import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { baseColumns, moneyCents, timestamptz } from "../conventions";
import { anyItemReference, quantity, trigram } from "./common";
import { events } from "./events";

// Recipe book (FLOW-93): one row per dish. Yield is optional (a dish with no
// yield can't be scaled, FLOW-98). Allergens and dietary tags are set on the
// dish, not on its ingredients (FLOW-95). Steps are the numbered method lines, in
// order.
export const recipes = pgTable(
  "recipes",
  {
    ...baseColumns(),
    name: text("name").notNull(),
    category: text("category").notNull(),
    description: text("description").notNull().default(""),
    steps: jsonb("steps").$type<string[]>().notNull().default([]),
    finishingNote: text("finishing_note").notNull().default(""),
    yieldServings: quantity("yield_servings"),
    portionSize: text("portion_size").notNull().default(""),
    allergens: jsonb("allergens").$type<string[]>().notNull().default([]),
    dietaryTags: jsonb("dietary_tags").$type<string[]>().notNull().default([]),
    active: boolean("active").notNull().default(true),
  },
  (table) => [
    index("recipes_name_idx").on(table.category, sql`lower(${table.name})`),
    // Global search (FLOW-217): fuzzy dish names.
    trigram("recipes_name_trgm_idx", table.name),
  ],
).enableRLS();
// One ingredient line of a recipe (FLOW-93). Quantity and unit are optional
// ("Italian Seasoning"). entered_cost_cents is the typed line cost, used when the
// cost can't be calculated from the ingredient (FLOW-94); FT+ only.
export const recipeLines = pgTable(
  "recipe_lines",
  {
    ...baseColumns(),
    recipeId: uuid("recipe_id")
      .notNull()
      .references(() => recipes.id),
    // Any consumable, kitchen, bar or supply (FLOW-169), so no foreign key (FLOW-289).
    itemId: anyItemReference(),
    quantity: quantity("quantity"),
    unit: text("unit"),
    prepNote: text("prep_note").notNull().default(""),
    enteredCostCents: moneyCents("entered_cost_cents"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [
    index("recipe_lines_recipe_idx").on(table.recipeId),
    index("recipe_lines_item_idx").on(table.itemId),
  ],
).enableRLS();
// The kitchen menu (FLOW-137): one per event, with the time food leaves the kitchen.
export const kitchenMenus = pgTable("kitchen_menus", {
  ...baseColumns(),
  eventId: uuid("event_id")
    .notNull()
    .unique()
    .references(() => events.id),
  leavesKitchenAt: timestamptz("leaves_kitchen_at"),
  generatedAt: timestamptz("generated_at"),
}).enableRLS();
export const kitchenMenuLines = pgTable(
  "kitchen_menu_lines",
  {
    ...baseColumns(),
    menuId: uuid("menu_id")
      .notNull()
      .references(() => kitchenMenus.id),
    recipeId: uuid("recipe_id")
      .notNull()
      .references(() => recipes.id),
    course: text("course").notNull(),
    // null is TBD.
    plannedQuantity: quantity("planned_quantity"),
    notes: text("notes").notNull().default(""),
    sourceKey: text("source_key"),
    edited: boolean("edited").notNull().default(false),
    // Who in the kitchen is in charge of this item (FLOW-293), from Kitchen ›
    // Overview. A user id; no foreign key, as with other staff links (FLOW-270).
    inChargeStaffId: uuid("in_charge_staff_id"),
  },
  (table) => [
    index("kitchen_menu_lines_menu_idx").on(table.menuId),
    uniqueIndex("kitchen_menu_lines_source_idx")
      .on(table.menuId, table.sourceKey)
      .where(sql`${table.sourceKey} is not null`),
    check(
      "kitchen_menu_lines_quantity_check",
      sql`${table.plannedQuantity} is null or ${table.plannedQuantity} >= 0`,
    ),
  ],
).enableRLS();
