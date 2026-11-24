import { strToU8, zipSync } from "fflate";

// A Word BEO in the company template's layout (FLOW-338) with invented values
// only: title line, Event summary with Duration, Menu with courses, Drinks,
// Staff, both schedule forms (a timed list and a TIME/EVENT/DETAILS table), a
// Setup/Decor list, further sections and a stray line. The real template stays
// in Flowbase-Data (ADR-27).
const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const p = (value: string, list = false) =>
  `<w:p>${list ? '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' : ""}<w:r><w:t xml:space="preserve">${escape(value)}</w:t></w:r></w:p>`;
const row = (cells: string[]) => `<w:tr>${cells.map((cell) => `<w:tc>${p(cell)}</w:tc>`).join("")}</w:tr>`;
const table = (rows: string[][]) => `<w:tbl>${rows.map(row).join("")}</w:tbl>`;

export const syntheticBeoBody = [
  p("BEO Sample Harbor Reunion"),
  p("EVENT SUMMARY"),
  p("Client Name: Testwood Family"),
  p("Date: 05/08/2027"),
  p("Address: 12 Example Lane, Sampletown"),
  p("# of Guests: 64"),
  p("Event Type: Plated dinner"),
  p("Components: food, drinks, staffing"),
  p("Transportation: truck #2"),
  p("Duration:"),
  p("3pm-5pm Set Up"),
  p("5pm-10pm Event"),
  p("MENU"),
  p("Cocktail Hour (5pm-6pm)"),
  p("Mock crostini - tray", true),
  p("Dinner - Plated"),
  p("Invented roast - chafing *GF", true),
  p("DRINKS"),
  p("Sample spritz - prebatched", true),
  p("STAFF"),
  p("Captain- Pat Example (captain)"),
  p("Server 1- Sam Sample (server)"),
  p("Schedule (option A)"),
  p("2:30PM Leave Warehouse"),
  p("3PM-5PM Set Up"),
  p("Schedule(Option B)"),
  table([
    ["TIME", "EVENT", "DETAILS"],
    ["5PM", "Guests Arrive", "Welcome drinks"],
    ["6:30-7PM", "Toasts", "quiet"],
  ]),
  p("Post event: team unloads the truck"),
  p("Setup/Decor List"),
  p("Centerpieces - 8 tables, 1 per", true),
  p("Inventory- Warehouse"),
  table([["Left", "Arrived", "Qty", "Item", "Unload"], ["", "", "8", "Sample linens", "floor"]]),
];

export function syntheticBeoDocx(): Uint8Array {
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${syntheticBeoBody.join("")}</w:body></w:document>`;
  return zipSync({
    "[Content_Types].xml": strToU8('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    "word/document.xml": strToU8(document),
  });
}
