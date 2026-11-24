// A synthetic copy of the kitchen ingredient sheet's layout (FLOW-89): the
// header, every row case the ticket names, and invented values only (ADR-27).
// Row numbers are the sheet's (the header is row 1).
export const kitchenInventoryCsv = [
  "Category,Subcategory,Item,Quantity,Cost/Unit,Distributor",
  // 2-3: Protein to the Fridge, values empty as in today's file.
  "Protein,Poultry,Sample Chicken Thigh,,,",
  "Protein,Seafood,Sample Shrimp,,,",
  // 4: Produce with every value filled ("$4.50"), from a distributor.
  "Produce,Herbs,Sample Basil,3,$4.50,Sample Produce Co",
  // 5: Dairy with a plain cost and the same distributor.
  "Dairy,Cheese,Sample Cheddar,2,4.50,Sample Produce Co",
  // 6: Dessert / Ice Creams to the Freezer.
  "Dessert,Ice Creams,Sample Vanilla Scoop,,,",
  // 7: other Dessert to the Pantry.
  "Dessert,Baked,Sample Brownie Mix,,,",
  // 8: Frozen & Prepared to the Freezer.
  "Other,Frozen & Prepared,Sample Dumplings,,,",
  // 9-10: Carb and Seasoning to the Pantry; trailing spaces.
  "  Carb ,Rice,  Sample Jasmine Rice  ,1,,",
  "Seasoning,Spice,Sample Smoked Paprika,,,",
  // 11: Sauce, Quantity as text.
  "Sauce,Base,Sample Tomato Base,half a tub,,",
  // 12: blank row.
  ",,,,,",
  // 13: the same Item again, other spacing and case: merged into row 4.
  "Produce,Herbs,sample  basil,1,,",
  // 14: no Item: skipped.
  "Produce,Herbs,,,,",
].join("\r\n");
// Rows the dry run accounts for: every row but the blank one.
export const kitchenNonBlankRows = 12;
