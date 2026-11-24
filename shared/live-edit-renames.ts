import type { CopyOverrides } from "./copy";
import type { LayoutDoc } from "./layout";

// Keeping the Admin's live edits across releases (FLOW-277). Saved wording
// (ui_copy) and page layouts (ui_layout) are matched to the code by key: a
// wording key, or a block or field-card id inside a page's layout. When code
// renames one, list it here so the saved edit follows it. When code drops one
// for good, list it under `removed`. The CI guard (tests/settings/live-edit-keys.test.ts)
// fails when a key or block id disappears from shared/generated/live-edit-keys.json
// without either entry. See docs/live-text-editing.md.

export type LiveEditRenames = {
  // Old wording key -> new wording key, e.g. "staff.staff-form.save-profile": "staff.staff-form.save".
  copy: Record<string, string>;
  // "<page key>/<old block or field-card id>" -> new id on the same page,
  // e.g. "events.detail/notes": "event-notes".
  blocks: Record<string, string>;
  // Keys and ids that are gone on purpose. Saved edits on them show in the
  // Admin's "no longer match a screen" notice, to delete or move.
  removed: { copy: string[]; blocks: string[] };
};

export const liveEditRenames: LiveEditRenames = {
  copy: {
    // FLOW-265: the Events screen's rebuilt Calendar panel and Day-of board.
    "calendar-detail.calendar-detail.open-event": "calendar.event-panel.open-event",
    // FLOW-266: the Inventory screen's shared heading, lines and shortcut cards.
    "imports.import-list.bring-records-in-from-a": "inventory-screen.imports.bring-records-in-from",
    "vendors.vendor-list.distributors-rental-vendors-and-event": "inventory-screen.vendors.distributors-rental-vendors-and",
    "inventory-lists.inventory-list.inventory": "inventory-screen.inventory-heading.inventory",
    // FLOW-267: the Kitchen screen's shared heading and its Recipes line.
    "recipes.recipe-list.every-dish-with-its-ingredients": "kitchen-screen.recipes.every-dish-with-its",
    "recipes.recipe-list.kitchen": "kitchen-screen.kitchen-heading.kitchen",
    // FLOW-300: the Recent imports table's columns as in the preview.
    "imports.import-log-table.when": "imports.import-log-table.date",
    "imports.import-log-table.created": "imports.import-log-table.new",
    "imports.import-log-table.failed": "imports.import-log-table.errors",
    "imports.import-log-table.unchanged": "imports.import-log-detail.unchanged",
    "imports.import-log-table.status": "imports.import-log-detail.status",
    // FLOW-289/291: Sections are Settings › Locations, and Start stock count
    // picks a location on the Inventory and Bar Inventory tabs.
    "inventory-sections.section-list.archive": "inventory-sections.locations-page.archive",
    "inventory-sections.section-list.in-stock": "inventory-sections.locations-page.in-stock",
    "inventory-sections.section-list.rename": "inventory-sections.locations-page.rename",
    "inventory-sections.section-list.restore": "inventory-sections.locations-page.restore",
    "inventory-sections.section-list.save-name": "inventory-sections.locations-page.save-name",
    "inventory-sections.section-list.show-archived": "inventory-sections.locations-page.show-archived",
    "inventory-lists.inventory-list.start-stock-count": "stock-counts.start-count.start-stock-count",
    "stock-counts.count-list.all-inventory": "stock-counts.count-mode.all-inventory",
  },
  blocks: { "documents.library/list": "documents-table" },
  removed: {
    // FLOW-265: wording of the replaced calendar detail mode, day-of board and
    // production overview, and the board's single urgent checkbox (now one
    // "Mark urgent" per event card). FLOW-266: the separate page titles, header
    // links and search box the Inventory screen's tabs, shortcut cards and
    // filters replace.
    copy: [
      // FLOW-310: the event hub's former log section.
      "day-of.event-day-of-section.day-of-log",
      "day-of.event-day-of-section.export-csv",
      "day-of.event-day-of-section.no-day-of-updates-yet",
      "day-of.event-day-of-section.showing-the-latest-updates",
      "day-of.event-day-of-section.system",
      "day-of.event-day-of-section.urgent",
      // FLOW-301: the client recipe book is a stored PDF now, not a fixed card.
      "kitchen-screen.menus.client-recipe-book",
      "kitchen-screen.menus.generated-from-the-recipes",
      // FLOW-294: the Day-of board page and tab, and the calendar's List view,
      // are gone; the calendar is Events › Overview.
      "calendar.calendar-page.list",
      "day-of.card.add",
      "day-of.card.add-a-note.placeholder",
      "day-of.card.guests",
      "day-of.card.mark-urgent",
      "day-of.card.service",
      "day-of.card.staff-count",
      "day-of.card.urgent-on",
      "day-of.checkpoint-row.clear",
      "day-of.checkpoint-row.mark-now",
      "day-of.checkpoint.actual",
      "day-of.checkpoint.no-plan",
      "day-of.checkpoint.not-yet",
      "day-of.checkpoint.planned",
      "day-of.checkpoint.record-now",
      "day-of.day-of-page.export-csv",
      "day-of.day-of-page.no-events-on-this-date",
      "day-of.day-of-page.no-staff-scheduled",
      "day-of.day-of-page.no-trucks-assigned",
      "day-of.day-of-page.today",
      "day-of.day-of-page.today-button",
      "day-of.day-of-page.today-suffix",
      "day-of.day-of-page.trucks",
      "day-of.truck-row.unassigned",
      "events-screen.day-of.live-board-for-each",
      "nav.calendar",
      "nav.day-of",
      // FLOW-267: the Recipes page's own title, now the Kitchen heading.
      "recipes.recipe-list.recipe-book",
      "calendar-detail.calendar-detail.allergens",
      "calendar-detail.calendar-detail.close",
      "calendar-detail.calendar-detail.contact",
      "calendar-detail.calendar-detail.event-details",
      "calendar-detail.calendar-detail.guests",
      "calendar-detail.calendar-detail.lead",
      "calendar-detail.calendar-detail.loading",
      "calendar-detail.calendar-detail.menu",
      "calendar-detail.calendar-detail.no-venue-yet",
      "calendar-detail.calendar-detail.notes",
      "calendar-detail.calendar-detail.open",
      "calendar-detail.calendar-detail.setup",
      "calendar-detail.calendar-detail.staff",
      "calendar.calendar-page.calendar",
      "calendar.calendar-page.detail-mode",
      "calendar.calendar-page.events-and-the-tasks-you",
      "day-of.checkpoint-row.not-marked",
      "day-of.checkpoint-row.planned",
      "day-of.checkpoint-row.reached",
      "day-of.checkpoint-row.reached-by",
      "day-of.day-of-page.day-of-board",
      "day-of.day-of-page.next-day",
      "day-of.day-of-page.previous-day",
      "day-of.day-of-page.staff",
      "day-of.day-of-page.urgent-text-the-people-affected",
      "day-of.staff-row.save",
      "day-of.truck-row.driver",
      "day-of.truck-row.save",
      "production.production-overview-page.days",
      "production.production-overview-page.event",
      "production.production-overview-page.production-overview",
      "production.production-overview-page.team",
      "production.production-overview-page.type",
      "production.production-overview-page.upcoming-work-across-events",
      "imports.import-list.importers",
      "imports.import-list.imports",
      "inventory-lists.bar-list.all-inventory",
      "inventory-lists.bar-list.bar",
      "inventory-lists.bar-list.bar-2",
      "inventory-lists.bar-list.beer-wine-and-liquor-what",
      "inventory-lists.bar-list.count",
      "inventory-lists.inventory-list.approvals",
      "inventory-lists.inventory-list.bar",
      "inventory-lists.inventory-list.counts",
      "inventory-lists.inventory-list.ingredients",
      "inventory-lists.inventory-list.items",
      "inventory-lists.inventory-list.items-2",
      "inventory-lists.inventory-list.master-sheet",
      "inventory-lists.inventory-list.order-lists",
      "inventory-lists.inventory-list.rentals-decor-kitchen-bar-and",
      "inventory-lists.inventory-list.search-item-name-or-code.placeholder",
      "inventory-lists.inventory-list.sections",
      "inventory-lists.inventory-list.stock-supplies",
      "inventory-lists.inventory-list.supplies",
      "vendors.vendor-list.inventory",
      "vendors.vendor-list.vendors",
      // FLOW-289/291/292: the Master sheet, Supplies, Low stock, Sections, Counts
      // list, Purchasing and Kitchen orders pages, the shortcut cards and the
      // "Stock & Supplies" eyebrows are gone; wording that now means a location.
      "inventory-detail.inventory-detail.section",
      "inventory-detail.inventory-detail.stock-by-section",
      "inventory-item-form.item-form-fields.storage-section",
      "inventory-item-form.item-form-fields.where-it-sits-in-the",
      "inventory-lists.bar-list.start-bar-count",
      "inventory-lists.ingredient-list.all-inventory",
      "inventory-lists.ingredient-list.count",
      "inventory-lists.ingredient-list.disposables-pack-sizes-stock-and",
      "inventory-lists.ingredient-list.ingredients",
      "inventory-lists.ingredient-list.kitchen",
      "inventory-lists.ingredient-list.kitchen-orders",
      "inventory-lists.ingredient-list.load-more-supplies",
      "inventory-lists.ingredient-list.low-stock",
      "inventory-lists.ingredient-list.new-supply",
      "inventory-lists.ingredient-list.search-supplies.placeholder",
      "inventory-lists.ingredient-list.start-stock-count",
      "inventory-lists.ingredient-list.supplies",
      "inventory-lists.ingredient-list.supplies-2",
      "inventory-lists.ingredient-list.supplies-3",
      "inventory-lists.ingredient-list.what-the-kitchen-buys-how",
      "inventory-lists.inventory-list.all-kinds",
      "inventory-lists.inventory-list.low-stock",
      "inventory-master.master-inventory.all-items-and-sections-grouped",
      "inventory-master.master-inventory.export-csv",
      "inventory-master.master-inventory.items",
      "inventory-master.master-inventory.master-inventory",
      "inventory-master.master-inventory.open",
      "inventory-master.master-inventory.pending",
      "inventory-master.master-inventory.save-changes",
      "inventory-master.master-inventory.search.placeholder",
      "inventory-master.master-inventory.stock-supplies",
      "inventory-master.master-inventory.submit-batch-for-approval",
      "inventory-master.status.active",
      "inventory-master.status.archived",
      "inventory-master.status.inactive",
      "inventory-master.status.pending",
      "inventory-screen.purchasing.order-lists-cover-a-date",
      "inventory-screen.shortcuts.counts-in-progress",
      "inventory-screen.shortcuts.every-item-all-kinds",
      "inventory-screen.shortcuts.items-below-par",
      "inventory-screen.shortcuts.kitchen-orders",
      "inventory-screen.shortcuts.low-stock",
      "inventory-screen.shortcuts.master-inventory",
      "inventory-screen.shortcuts.open-order-lists",
      "inventory-screen.shortcuts.sections",
      "inventory-screen.shortcuts.stock-counts",
      "inventory-screen.shortcuts.storage-sections",
      "inventory-sections.section-list.add-section",
      "inventory-sections.section-list.all-inventory",
      "inventory-sections.section-list.holds",
      "inventory-sections.section-list.new-section-name",
      "inventory-sections.section-list.sections",
      "inventory-sections.section-list.stock-supplies",
      "inventory-sections.section-list.where-stock-lives-vendor-holds",
      "inventory-stock-forms.movement-form.section",
      "inventory-stock-forms.stock-form.from-section",
      "inventory-stock-forms.stock-form.moves-stock-between-sections-and",
      "inventory-stock-forms.stock-form.records-what-you-counted-in",
      "inventory-stock-forms.stock-form.section",
      "inventory-stock-forms.stock-form.to-section",
      "kitchen-orders.kitchen-order-status.current-kitchen-purchasing-lists",
      "kitchen-orders.kitchen-order-status.order-list-status",
      "kitchen-orders.kitchen-order-status.order-lists",
      "kitchen-orders.kitchen-order-status.to",
      "nav.kitchen-orders",
      "nav.low-stock",
      "nav.master-inventory",
      "nav.purchasing",
      "nav.sections",
      "nav.stock-counts",
      "nav.supplies",
      "order-lists.order-list-detail.stock-supplies",
      "order-lists.order-lists.stock-supplies",
      "purchasing.page.vendor-orders",
      "settings.list-settings.inventory-sections",
      "stock-counts.count-list.count-a-storage-section-item",
      "stock-counts.count-list.counts",
      "stock-counts.count-list.resume-count",
      "stock-counts.count-list.start-count",
      "stock-counts.count-list.started-counted",
      "stock-counts.count-list.stock-supplies",
      "stock-counts.count-list.storage-sections",
      "stock-counts.count-mode.all-counts",
      "stock-counts.count-mode.nothing-is-kept-in-this",
      "stock-counts.low-stock-list.all-inventory",
      "stock-counts.low-stock-list.counts",
      "stock-counts.low-stock-list.ingredients-bar-stock-and-supplies",
      "stock-counts.low-stock-list.items-below-par",
      "stock-counts.low-stock-list.load-more-items",
      "stock-counts.low-stock-list.low-stock",
      "stock-counts.low-stock-list.stock-supplies",
    ],
    blocks: [
      "events.detail/day-of",
      "day-of.board/urgent",
      "day-of.board/events",
      // FLOW-291/292: the pages and the shortcut cards that are gone.
      "inventory.counts/sections",
      "inventory.low-stock/list",
      "inventory.master/filters",
      "inventory.master/groups",
      "inventory.purchasing/filters",
      "inventory.purchasing/lists",
      "kitchen.orders/order-lists",
      "inventory.list/shortcuts",
    ],
  },
};


// A rename's final key: follows a chain (a -> b -> c), stops on a loop.
function follow(map: Record<string, string>, key: string): string {
  const seen = new Set<string>();
  let current = key;
  while (Object.hasOwn(map, current) && !seen.has(current)) {
    seen.add(current);
    current = map[current];
  }
  return current;
}

export const resolveCopyKey = (key: string, renames: LiveEditRenames = liveEditRenames) => follow(renames.copy, key);

// The old keys that now resolve to this key.
export function copyAliases(key: string, renames: LiveEditRenames = liveEditRenames): string[] {
  return Object.keys(renames.copy).filter((old) => old !== key && resolveCopyKey(old, renames) === key);
}

// Saved wording as the code reads it now: an override saved under an old key
// shows under its new key. A row saved under the new key itself wins.
export function renameCopyOverrides(overrides: CopyOverrides, renames: LiveEditRenames = liveEditRenames): CopyOverrides {
  const result: CopyOverrides = {};
  for (const [key, text] of Object.entries(overrides)) if (resolveCopyKey(key, renames) === key) result[key] = text;
  for (const [key, text] of Object.entries(overrides)) {
    const next = resolveCopyKey(key, renames);
    if (next !== key && !(next in result)) result[next] = text;
  }
  return result;
}

export function resolveBlockId(pageKey: string, id: string, renames: LiveEditRenames = liveEditRenames): string {
  const seen = new Set<string>();
  let current = id;
  while (Object.hasOwn(renames.blocks, `${pageKey}/${current}`) && !seen.has(current)) {
    seen.add(current);
    current = renames.blocks[`${pageKey}/${current}`];
  }
  return current;
}

// A saved layout as the code reads it now: renamed built-in blocks and field
// cards take their new ids. A block already saved under the new id wins. The
// next Save of the page stores the new ids, so the entry can later be dropped.
export function renameLayoutDoc(pageKey: string, doc: LayoutDoc, renames: LiveEditRenames = liveEditRenames): LayoutDoc {
  const taken = new Set(doc.blocks.filter((block) => resolveBlockId(pageKey, block.id, renames) === block.id).map((b) => b.id));
  const blocks = doc.blocks.flatMap((block): LayoutDoc["blocks"] => {
    if (block.kind !== "builtin") return [block];
    const id = resolveBlockId(pageKey, block.id, renames);
    if (id === block.id) return [block];
    if (taken.has(id)) return [];
    taken.add(id);
    return [{ ...block, id }];
  });
  const fieldBoxes: LayoutDoc["fieldBoxes"] = {};
  const entries = Object.entries(doc.fieldBoxes);
  for (const [key, value] of entries) if (resolveBlockId(pageKey, key, renames) === key) fieldBoxes[key] = value;
  for (const [key, value] of entries) {
    const id = resolveBlockId(pageKey, key, renames);
    if (id !== key && !(id in fieldBoxes)) fieldBoxes[id] = value;
  }
  return { ...doc, blocks, fieldBoxes };
}
