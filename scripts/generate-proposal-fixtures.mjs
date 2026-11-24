// Synthetic finalized-proposal Word files for tests/sales/proposal-template-rules.test.ts (FLOW-314).
// They reproduce the two real layouts (event proposal with rentals/decor/florals
// tables and a breakdown, and a dinner proposal with a per-person menu) using
// invented clients, venues and amounts. The real exports live in the private
// Flowbase-Data repo and never belong in this public repo (ADR-27).
//
// Regenerate: node scripts/generate-proposal-fixtures.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";

const OUT_DIR = join("tests", "fixtures", "proposals");

const escape = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const run = (text) => `<w:r><w:t xml:space="preserve">${escape(text)}</w:t></w:r>`;
const paragraph = (text, style) =>
  `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}${text.split("\n").map(run).join("")}</w:p>`;
const cell = (text) => `<w:tc>${(text || "").split("\n").map((line) => paragraph(line)).join("") || "<w:p/>"}</w:tc>`;
const table = (rows) => `<w:tbl>${rows.map((row) => `<w:tr>${row.map(cell).join("")}</w:tr>`).join("")}</w:tbl>`;

// Content: strings are paragraphs, { h } is a Heading-styled paragraph, arrays are tables.
const render = (content) =>
  content.map((item) => (Array.isArray(item) ? table(item) : typeof item === "string" ? paragraph(item) : paragraph(item.h, "Heading2"))).join("");

const documentXml = (content) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${render(content)}<w:sectPr/></w:body></w:document>`;

const contentTypes =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/>` +
  `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
  `</Types>`;
const rootRels =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
  `</Relationships>`;

// A fixed timestamp keeps regenerated files byte-identical.
const mtime = new Date("2026-01-01T00:00:00Z");
const docx = (content) =>
  zipSync({
    "[Content_Types].xml": [strToU8(contentTypes), { mtime }],
    "_rels/.rels": [strToU8(rootRels), { mtime }],
    "word/document.xml": [strToU8(documentXml(content)), { mtime }],
  }, { level: 9 });

const itemHeader = ["Rental Item", "Details:", "Cost per Unit/Set:", "Quantity:", "Total:"];

const eventProposal = [
  "Prepared For: Avery Sample & Jordan Example",
  "Contacts: (555) 010-0100 couple@example.test",
  "Date of Event: 09/12/2026",
  "Event Location: 400 Sample Avenue, Testville",
  "Schedule:",
  "2pm-5pm Setup",
  "5pm-11pm Event",
  "11pm-12:30am Breakdown",
  "COCKTAIL HOUR $1,250",
  "Grazing Board $1,100",
  "*Seasonal cheeses, cured meats, fruit and crackers*",
  "No: walnuts",
  "Mini Cookie Stack $75 x 2 = $150",
  { h: "DINNER(food cart) $4,980" },
  { h: "Guests: $56 per person x 80 guests = $4,480" },
  "Vendors: 4 outside vendors = $500",
  "Herb Roasted Chicken Skewers",
  "Garden Noodle Cups **vegan**",
  "Smoked Paprika Potato Bites **vegetarian** → sauce on side",
  "DESSERT $300",
  "Lemon Sheet Cake $60",
  "Fruit Tart Cups: $4 each x 60 cups $240",
  "DRINKS",
  "Sparkling Lemonade $400",
  "Includes Water Bottles",
  "STAFFINGUniform: Black shirt, dark jeans, black shoes",
  [
    ["Position", "Hourly Rate", "Hours", "# of Staff", "Total Cost"],
    ["Prep", "$45", "5", "4", "$900"],
    ["Servers", "$55", "5", "6", "$1,650"],
    ["Total Staffing Cost", "$2,550"],
  ],
  "RENTALS",
  [
    itemHeader,
    ["Premium Buffet Set Up", "Includes boards, levelers, napkin holders and tongs", "$500", "1", "$500"],
    ["Folding Chairs", "white", "$5.00", "80", "$400.00"],
    ["Round Tables", "10 guest tables", "$15.00", "10", "$150.00"],
    ["", "Cake Table", "$15.00", "1", "$15.00"],
    ["MISC", ""],
    ["Magician", "close-up tables", "$900.00", "1", "$900.00"],
    ["Total", "", "", "", "$1,965.00"],
  ],
  "DECOR",
  [
    itemHeader,
    ["LARGE DECOR", ""],
    ["Flower Wall", "by the entrance", "$1,200", "1", "$1,200"],
    ["SMALL DECOR", ""],
    ["Table Numbers", "acrylic", "$5.00", "10", "$50.00"],
    ["Total", "", "", "", "$1,250.00"],
  ],
  "FLORALS",
  [
    ["Item", "Details:", "Cost per Unit/Set:", "Quantity:", "Total:"],
    ["Bridal Bouquet", "white peonies", "$300", "1", "$300"],
    ["Centerpieces", "-", "$40", "10", "$400"],
    ["", "", "", "", "$700"],
  ],
  [
    ["ESTIMATED BREAKDOWN", ""],
    ["Food(Cocktail, Dinner, Dessert)", "$6,530.00"],
    ["Drinks", "$400.00"],
    ["Staffing", "$2,550.00"],
    ["Rentals", "$1,965.00"],
    ["Decor", "$1,250.00"],
    ["Florals", "$700.00"],
    ["20% Service Fee", "$2,679.00"],
    ["TOTAL", "$16,074.00"],
    ["Partial Coordination", "$2,500.00"],
    ["FINAL TOTAL", "$18,574.00"],
  ],
  "Deposit paid to Sample Catering Co.: $5,000.00",
  "Remaining Balance Due After Deposit: $13,574.00",
  "Contract",
  "This agreement is made by and between Sample Catering Co. (\"Caterer\") and the Client named above (\"Client\").",
  "Catering Event will take place on: September 12, 2026 Event Hours: 5:00 PM – 11:00 PM",
  "Total Amount Due: $18,574.00 The Client has paid the Caterer a deposit of $5,000.00. Remaining Balance Due After Deposit: $13,574.00",
  "The Client shall remit the final payment in full no later than forty-eight (48) hours prior to the scheduled event date. A grace period through the day of the event may be granted.",
  "Client Signature: _________________________________",
];

const dinnerProposal = [
  "Milestone Birthday Dinner",
  "Client: Sample Client",
  "Phone: (555) 010-0200",
  "Location: 22 Example Court, Testville",
  "# of Guests: 40 guests",
  "Date: November 7, 2026",
  "Event Duration: 5-8pm *venue access 4pm-9pm*",
  "Schedule:",
  "Setup 4pm-5pm",
  "Food Service 5pm-7:30pm",
  "Breakdown 7:30pm-8pm",
  "About Our Company",
  "Sample Catering Co. is an invented catering company used only in tests.",
  "MENU $28 per person x 40 guests = $1,120",
  "Garden Salad(GF) *dressing on side*",
  "Penne Pomodoro **chafing",
  "Lemon Herb Chicken(GF) **chafing",
  "Optional Add-Ons",
  "Option 1  $200.00 - Choose 2:",
  "Cookies / Brownie Bites / Fruit Cups",
  "*all menu changes must be finalized two weeks before the event*",
  "STAFFING",
  "4pm-8pm 3 staff",
  [
    ["Position", "Hourly Rate", "# of Staff", "Hours", "Total Cost"],
    ["Prep Staff (Set-Up/Breakdown)", "$45", "2", "2", "$180"],
    ["Servers", "$55", "3", "2", "$330"],
    ["Total Staffing Cost", "$510"],
  ],
  "RENTALS subject to change",
  [
    itemHeader,
    ["Basic Buffet Set Up", "Includes boards and levelers", "$150", "1", "$150"],
    ["Chafing Dish Sets", "Standard Set", "$20.00", "3", "$60.00"],
    ["", "Premium Set", "$45.00", "", "$0.00"],
    ["Total", "", "", "", "$210.00"],
  ],
  "NEW BREAKDOWN",
  [
    ["Full Service", ""],
    ["Food", "$1,120.00"],
    ["Staffing", "$510.00"],
    ["Rentals", "$210.00"],
    ["Delivery Fee", "$100.00"],
    ["Total before fees & taxes:", "$1,940.00"],
    ["15% Service Fee", "$291.00"],
    ["6% Sales Tax:", "$116.40"],
    ["ESTIMATED TOTAL via ACH", "$2,347.40"],
  ],
  "Contract",
  "This agreement is made by and between Sample Catering Co. (\"Caterer\") and the Client named above (\"Client\").",
  "Event Hours: 5pm-7:30pm",
  "The Client shall pay the Caterer the full balance of $2,347.40 via ACH by Monday, October 26, 2026.",
  "Client Signature:",
];

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "synthetic-proposal-event.docx"), docx(eventProposal));
writeFileSync(join(OUT_DIR, "synthetic-proposal-dinner.docx"), docx(dinnerProposal));
console.log(`Wrote synthetic proposals to ${OUT_DIR}`);
