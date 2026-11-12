// A synthetic copy of the Bar Inventory "Master Sheet" tab's layout (FLOW-91): the
// header with the note in column J, capitals category rows (with a type in
// brackets), non-capital item-only rows, tiers, units, numeric and text Qty,
// distributors including "-" and asterisk text, trailing spaces and blank rows.
// Invented values only (ADR-27). Row numbers are the sheet's (header is row 1).
export const barInventoryCsv = [
  'Item,Qty,Unit,Details,Distributor,,,,,"round to nearest .5 for all beer/wine\nround to nearest .25 for all liquor"',
  "BEER,,,,,,,,,", // 2
  "Sample Lager,4,24pk,,Sample Beer Co,,,,,", // 3
  "Coors Lite ,0,24pk,,Sample Beer Co ,,,,,", // 4: spelling suggestion
  "Sample NA Beer,1,6pk,N/A,-,,,,,", // 5: non-alcoholic, no distributor
  "Sample Seltzer,7,12,,-,,,,,", // 6: a bare pack count
  "Sample Mixed Pack,1,12 bottles,,,,,,,", // 7
  ",,,,,,,,,", // 8
  "WINE (White) ,,,,,,,,,", // 9
  "Sample Pinot Grigio,1.5,12pk,,Impero Wine Distributors,,,,,", // 10
  "WINE (Red),,,,,,,,,", // 11
  "Sample Cabernet,2 case,12 bottles,,Impero Wine Distributors,,,,,", // 12
  "CHAMPAGNE,,,,,,,,,", // 13
  "Sample Bubbles,2full 2 half,12 bottles,,Sample Wine Co,,,,,", // 14
  "Sample Reserve,,,high,*other higher end dist.*,,,,,", // 15
  ",,,,,,,,,", // 16
  "LIQUOR (Vodka),,,,,,,,,", // 17
  "Sample Rail Vodka,1,,rail,Sample ABC,,,,,", // 18
  "Sample Mid Vodka,3.25,,mid/high,Sample ABC,,,,,", // 19: combined tier
  "LIQUOR (Gin),,,,,,,,,", // 20
  "Sample Rail Vodka,2,,rail,Sample ABC,,,,,", // 21: same name, another type
  "MIXERS & JUICES,,,,,,,,,", // 22
  "Sample Juice,3 case,,,,,,,,", // 23: cases of nothing in particular
  "Sample Cranberry,2full 2 half,(64 floz),,,,,,,", // 24: a container size
  "Sample Tonic,2 crates ,12 bottles(1QT/per),,,,,,,", // 25
  "GARNISHES,,,,,,,,,", // 26
  "Sample Mint,,,,,,,,,", // 27: not a category row
  "SOFT BEVERAGES,,,,,,,,,", // 28
  "Sample Cola,1/2 case,,,,,,,,", // 29
  "Sample Seltzer Water,1 case,12pk,,Hop & Wine - (german beers),,,,,", // 30
].join("\n");

// Category rows: 2, 9, 11, 13, 17, 20, 22, 26 and 28.
export const barCategoryRows = [2, 9, 11, 13, 17, 20, 22, 26, 28];
// The non-blank rows below the header.
export const barNonBlankRows = 27;
