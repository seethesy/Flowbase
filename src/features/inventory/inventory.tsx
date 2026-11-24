// Inventory (FLOW-69/70/81/71/83/90, FLOW-289): every item Flowbase tracks or
// sells in its three lists (Master, Bar and Kitchen Ingredients), the locations
// stock lives in, and each item's movement and cost history. Count mode is in
// stock-counts.tsx and the Order tab in inventory-order.tsx.
//
// One file per screen or form (FLOW-193): inventory-lists, -item-form,
// -stock-forms, -histories, -detail and -sections, with shared labels in
// inventory-labels.ts.
export {
  changeLabel,
  dateTimeLabel,
  quantityLabel,
} from "./inventory-labels";
export {
  BarList,
  IngredientList,
  InventoryList,
} from "./inventory-lists";
export { InventoryDetail } from "./inventory-detail";
export { LocationsPage } from "./inventory-sections";
