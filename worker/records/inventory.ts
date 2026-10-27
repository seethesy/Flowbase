// Inventory items (FLOW-69), sections and per-section stock (FLOW-70), the
// ingredient catalog fields (FLOW-81), the stock ledger (FLOW-71), count mode
// (FLOW-82), cost history (FLOW-83) and bar stock (FLOW-90). Every signed-in user
// can read inventory; consumable costs are FT+ only (F-01-04). Stock changes only
// through recordMovement, which writes the movements and the cached quantities
// together; nothing sets a quantity directly.
//
// Split by area (FLOW-193): inventory-sections, -items, -costs, -ledger and -counts.
// Import from here or from the area's own file.
export {
  createSection,
  listSections,
  renameSection,
  setSectionArchived,
} from "./inventory-sections";
export {
  createItem,
  findItem,
  getItem,
  itemHistory,
  listItems,
  setItemArchived,
  updateItem,
} from "./inventory-items";
export type { ItemFilter } from "./inventory-items";
export { listCostHistory, recordCostChange } from "./inventory-costs";
export {
  addMovement,
  correctMovement,
  countStock,
  listMovements,
  recordMovement,
  recordStartingStock,
  transferStock,
} from "./inventory-ledger";
export type { Movement } from "./inventory-ledger";
export {
  completeCount,
  getCount,
  listCounts,
  recordCountLine,
  startCount,
} from "./inventory-counts";
