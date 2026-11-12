// A synthetic copy of the Master Inventory "Main" tab's layout (FLOW-78): the
// header, every row case the ticket names, and invented values only (ADR-27).
// Row numbers are the sheet's (the header is row 1).
export const masterInventoryCsv = [
  "Category,Subcategory,Item,Qty,Description,Location,Pull Owner,Cost,Distributor",
  // 2: a rental with every column filled, bought from a store.
  "On-site Kitchen,Heating,Sample Wire Chafer,4,,Warehouse,Pull Lead,40,Sample Store",
  // 3: Sternos are used up at events.
  "On-site Kitchen,Heating,Sternos - sample pack,1,72 pk,Warehouse,Pull Lead,0,",
  // 4: blank Qty and Cost.
  "On-site Kitchen,Heating,Sample Heat Lamp,,,Warehouse,Pull Lead,,",
  // 5-7: the same Item told apart by Description.
  "AV,Sound,Sample Microphone,2,wireless,Warehouse,Production Lead,25,",
  "AV,Sound,Sample Microphone,1,wired,Warehouse,Production Lead,25,",
  "AV,Sound,Sample Microphone,3,clip-on,Warehouse,Production Lead,,",
  // 8-9: identical rows merge.
  "Buffet Rentals,Plates,Sample Cutting Board,4,,Warehouse,Pull Lead,,",
  "Buffet Rentals,Plates,Sample Cutting Board,4,,Warehouse,Pull Lead,,",
  // 10-12: Qty as "-", "?" and text; Guest Disposables and Packing are supplies.
  "Guest Disposables,Cutlery,Sample Plastic Fork,-,black,Jamie's,Pull Lead,5,",
  "Guest Disposables,Cutlery,Sample Plastic Knife,?,black,Jamie's,Pull Lead,5,",
  "Packing,Transport,Sample Wrap,48 in box,,Storage Box,Pull Lead,2,",
  // 13: the one service.
  "Decor,Signage,Menu Card Design,,,Jamie's,Sales Manager,,",
  // 14-15: no Item (empty, then a space).
  "Decor,Wedding,,,,Jamie's,,,",
  "Decor,Styrofoam Props, ,1,,Jamie's,Production Lead,,",
  // 16: no Category or Subcategory, text Qty, blank Location, Pull Owner, Cost.
  ",,Sample Loose Item,2  box full ,,,,,",
  // 17: no Category, a Subcategory and a Location.
  ",Floral,Sample Gold Vase,,,Storage Box,,,",
  // 18: a blank row.
  ",,,,,,,,",
  // 19: spaces around the Item.
  "Rentals,Chair,  Sample Padded Chair  ,3,,Warehouse,Sales Manager,15,",
].join("\n");

// The non-blank rows below the header: 2-17 and 19.
export const masterNonBlankRows = 17;
