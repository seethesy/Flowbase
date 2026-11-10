import type { ProposalMapping, ProposalLine } from "../../shared/proposal-mapping";
import type { ProposalBlock } from "./proposal-docx";

const money = /\$[\d,]+(?:\.\d{2})?/;
const date = /(?:\d{1,2}\/\d{1,2}\/\d{4}|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})/i;
const timeRange = /(\d{1,2}(?::\d{2})?\s*(?:am|pm))\s*[-–]\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm))/i;
const trim = (value: string) => value.replace(/\s+/g, " ").trim();
const isHeading = (text: string) => /^STAFFINGUniform/i.test(text) || /^(?:COCKTAIL HOUR|DINNER|DESSERT|DRINKS|MENU|STAFFING|RENTALS|DECOR|FLORALS|NEW BREAKDOWN|ESTIMATED BREAKDOWN|UPDATED BREAKDOWN|Previous Pricing Total|Contract|Optional Add-Ons|LARGE DECOR|SMALL DECOR)\b/i.test(text);

/** Rules for the two finalized proposal layouts. Unknown blocks stay available for review. */
export function extractProposalTemplate(blocks: ProposalBlock[], versionId: string): ProposalMapping {
  const mapping: ProposalMapping = { versionId, fields: {}, lines: [], staffing: [], timeline: [], charges: [], paymentSchedule: [], unextractedBlockIds: [] };
  const seen = new Set<string>();
  let section = "";
  let menuSection = "";
  let menuActive = false;
  let lineNumber = 0;
  let inSchedule = false;
  let inContract = false;
  let lastMenu: ProposalLine | undefined;
  let staffCountColumn = -1;
  const field = (key: string, value: string, source: ProposalBlock) => {
    if (!mapping.fields[key] && trim(value) && !/^[_\s.]+$/.test(value)) {
      mapping.fields[key] = { value: trim(value), sourceBlockId: source.id };
      seen.add(source.id);
    }
  };
  const sourced = (key: "timeline" | "charges" | "paymentSchedule", value: string, source: ProposalBlock) => {
    mapping[key].push({ value: trim(value), sourceBlockId: source.id });
    seen.add(source.id);
  };
  const line = (kind: ProposalLine["kind"], name: string, source: ProposalBlock, notes = "", quantity: number | null = null) => {
    if (!trim(name)) return;
    const item: ProposalLine = { id: `extracted-${++lineNumber}`, kind, section: kind === "menu" ? menuSection : section, name: trim(name).slice(0, 200), notes: trim(notes).slice(0, 2000), quantity, sourceBlockId: source.id, catalogId: null, notTracked: false };
    mapping.lines.push(item);
    seen.add(source.id);
    if (kind === "menu") lastMenu = item;
  };

  for (const block of blocks) {
    const text = trim(block.text);
    const cells = block.rows?.[0]?.map(trim) ?? [];
    const label = cells[0] ?? "";
    if (!text) continue;
    if (/^Contract$/i.test(text)) inContract = true;
    if (!inContract) {
      const eventDate = text.match(/^(?:Date of Event|Date):\s*(.*)/i);
      if (eventDate) field("eventDate", eventDate[1].match(date)?.[0] ?? "", block);
      const location = text.match(/^(?:Event Location|Location):\s*(.*)/i);
      if (location) {
        const value = trim(location[1]);
        if (value && !/^[_\s.]+$/.test(value)) {
          field("address", value, block);
        }
      }
      const venue = text.match(/^Venue:\s*(.+)/i);
      if (venue) field("venue", venue[1], block);
      const guests = text.match(/^(?:# of Guests|Guests):\s*(?:\$[^=]+=\s*)?(\d+)\s*guests?/i) ?? text.match(/^(?:# of Guests|Guests):.*?\b(\d+)\s*guests?/i);
      if (guests) field("guestCount", guests[1], block);
      if (/birthday/i.test(text) && !mapping.fields.eventType) field("eventType", "Birthday", block);
      if (/wedding/i.test(text) && /prepared for|^wedding/i.test(text)) field("eventType", "Wedding", block);
      if (/^Event Duration:/i.test(text)) {
        const range = text.match(/\b(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*[-–]\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm))/i);
        if (range) { field("startTime", /am|pm/i.test(range[1]) ? range[1] : `${range[1]}${range[2].match(/am|pm/i)?.[0]}`, block); field("endTime", range[2], block); }
      }
      if (/^\d{1,2}(?::\d{2})?\s*(?:am|pm)\s*[-–]\s*\d{1,2}/i.test(text) && /\bEvent\b/i.test(text)) {
        const range = text.match(timeRange);
        if (range) { field("startTime", range[1], block); field("endTime", range[2], block); }
      }
      if (/^Full Service\b/i.test(label)) { field("serviceType", "Full Service", block); line("service", "Full Service", block); }
      if (/^Partial Coordination\b/i.test(label)) field("serviceType", "Partial Coordination", block);
      if (/food cart/i.test(text)) field("foodServiceStyle", "Food cart", block);
      else if (/^Basic Buffet Set Up/i.test(label)) field("foodServiceStyle", "Buffet", block);
      if (/Bridal Bouquet|Wedding aisle/i.test(text)) field("eventType", "Wedding", block);
    }

    if (isHeading(text) && !block.rows) {
      section = text.replace(/\s*\$[\d,]+.*$/, "").trim();
      menuActive = /^(?:COCKTAIL HOUR|DINNER|DESSERT|DRINKS|MENU|Optional Add-Ons)/i.test(section);
      if (menuActive) menuSection = section;
      inSchedule = false;
      lastMenu = undefined;
      if (/^MENU\b/i.test(text) && money.test(text)) sourced("charges", text, block);
      if (/^DINNER\b/i.test(text) && money.test(text)) sourced("charges", text, block);
      if (/^COCKTAIL HOUR\b|^DESSERT\b/i.test(text) && money.test(text)) sourced("charges", text, block);
      continue;
    }
    if (/^Schedule:$/i.test(text)) { inSchedule = true; continue; }
    if (inSchedule && /\b(?:Setup|Event|Food Service|Breakdown)\b/i.test(text) && timeRange.test(text)) {
      sourced("timeline", text, block); continue;
    }

    if (block.kind === "table") {
      if (/^(?:ESTIMATED BREAKDOWN|UPDATED BREAKDOWN|Previous Pricing Total)/i.test(label)) { section = label; continue; }
      if (/^Position$/i.test(label)) { staffCountColumn = cells.findIndex((cell) => /# of Staff/i.test(cell)); continue; }
      if (/^(?:Rental Item|Item)$/i.test(label)) continue;
      if (section.startsWith("STAFFING")) {
        if (/^Total Staffing/i.test(label)) { sourced("charges", text, block); continue; }
        const countIndex = staffCountColumn > 0 ? staffCountColumn : cells.findIndex((cell, index) => index > 0 && /^\d+$/.test(cell) && Number(cell) <= 30);
        if (label && countIndex > 0) {
          mapping.staffing.push({ position: label.slice(0, 100), count: Number(cells[countIndex]), sourceBlockId: block.id });
          seen.add(block.id);
        }
        continue;
      }
      if (/^(?:RENTALS|DECOR|FLORALS)/i.test(section)) {
        if (/^Total$/i.test(label) || (!label && cells.every((cell, index) => index === cells.length - 1 || !cell))) { if (money.test(text)) sourced("charges", text, block); continue; }
        if (/^(?:LARGE DECOR|SMALL DECOR)$/i.test(label)) { section = `DECOR ${label}`; continue; }
        const kind = /DECOR|FLORALS/i.test(section) ? "decor" : /Magician/i.test(label) ? "service" : "rental";
        const name = label || cells[1];
        const quantity = cells.length >= 4 && /^\d+(?:\.\d+)?$/.test(cells[3]) ? Number(cells[3]) : null;
        if (name && (quantity !== null || (label && money.test(text)))) line(kind, name, block, label ? cells[1] : "", quantity);
        continue;
      }
      if (/BREAKDOWN|Previous Pricing/i.test(section) || /BREAKDOWN|Previous Pricing/i.test(label)) {
        if (/^Partial Coordination$/i.test(label)) line("service", label, block);
        if (money.test(text)) sourced("charges", text, block);
        continue;
      }
    }

    if (inContract) {
      if (/\b(?:pay|payment|deposit|balance|fee|credit card|ACH|grace period|due)\b/i.test(text) && /(?:\$|payment|deposit|balance|credit card|ACH|grace period)/i.test(text)) sourced("paymentSchedule", text, block);
      continue;
    }
    if (/^(?:Deposit paid|Total Paid|Remaining Balance|\$[\d,.]+.*(?:PAID|balance)|.*FINAL BALANCE)/i.test(text)) { sourced("paymentSchedule", text, block); continue; }
    if (menuActive) {
      if (/^(?:No:|\*|Not saving|\(|\d+ bottles:|Includes |\$\d+ for|inspo:)/i.test(text) && lastMenu) {
        lastMenu.notes = trim(`${lastMenu.notes} ${text}`).slice(0, 2000);
        seen.add(block.id);
      } else if (/^Option \d+/i.test(text)) {
        line("menu", text, block);
      } else if (!/^Guests:|^Vendors:/i.test(text) && !/^\d+\s*staff/i.test(text)) {
        const detail = text.search(/(?:\s+(?:\*|→|\$[\d,.]+)|\((?:GF|vegetarian|vegan)\))/i);
        const name = detail >= 0 ? text.slice(0, detail) : text;
        line("menu", name, block, detail >= 0 ? text.slice(detail) : "");
      }
      if (money.test(text)) sourced("charges", text, block);
    }
  }
  mapping.unextractedBlockIds = blocks.filter((block) => !seen.has(block.id)).map((block) => block.id);
  return mapping;
}

// Carry explicit review decisions forward while refreshing values and pointers
// from the newly uploaded Word version.
export function carryPreviousProposalReview(current: ProposalMapping, previous: ProposalMapping | null): ProposalMapping {
  if (!previous) return current;
  const oldLines = new Map(previous.lines.map((item) => [`${item.kind}:${item.name.toLowerCase()}`, item]));
  const lines = current.lines.map((item) => {
    const old = oldLines.get(`${item.kind}:${item.name.toLowerCase()}`);
    return old ? { ...item, catalogId: old.catalogId, notTracked: old.notTracked } : item;
  });
  for (const item of previous.lines) {
    if (item.sourceBlockId === null && !lines.some((line) => line.kind === item.kind && line.name.toLowerCase() === item.name.toLowerCase()))
      lines.push({ ...item, id: `carried-${item.id}` });
  }
  const fields = { ...current.fields };
  for (const [key, value] of Object.entries(previous.fields))
    if (!fields[key] && value.sourceBlockId === null) fields[key] = value;
  const carryManual = (key: "timeline" | "charges" | "paymentSchedule") => [
    ...current[key], ...previous[key].filter((item) => item.sourceBlockId === null),
  ];
  return {
    ...current, fields, lines,
    staffing: [...current.staffing, ...previous.staffing.filter((item) => item.sourceBlockId === null)],
    timeline: carryManual("timeline"), charges: carryManual("charges"), paymentSchedule: carryManual("paymentSchedule"),
  };
}
