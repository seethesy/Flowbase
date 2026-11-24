// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { parseProposalDocx } from "../../src/features/sales/proposal-docx";
import { readBeoFile } from "../../src/features/beo/beo-import-read";
import { beoImportInputSchema, beoImportKind, eventFromSummary, extractBeo, importedNotes } from "../../shared/beo-import";
import { syntheticBeoDocx } from "../fixtures/beo/synthetic-beo";

// FLOW-338: reading a Word BEO in the template's layout (synthetic, ADR-27).
const blob = (bytes: Uint8Array) => ({ arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }) as Blob;
const sample = async () => extractBeo(await parseProposalDocx(blob(syntheticBeoDocx())));

describe("FLOW-338: extracting a BEO from the template layout", () => {
  it("recognizes the event summary, menu, drinks and staff (AC1)", async () => {
    const draft = await sample();
    expect(draft.summary).toEqual({
      title: "Sample Harbor Reunion",
      client: "Testwood Family",
      date: "05/08/2027",
      address: "12 Example Lane, Sampletown",
      guests: "64",
      eventType: "Plated dinner",
      components: "food, drinks, staffing",
      transportation: "truck #2",
    });
    expect(draft.durations).toEqual(["3pm-5pm Set Up", "5pm-10pm Event"]);
    expect(draft.menu).toEqual(["Cocktail Hour (5pm-6pm)", "Mock crostini - tray", "Dinner - Plated", "Invented roast - chafing *GF"]);
    expect(draft.drinks).toEqual(["Sample spritz - prebatched"]);
    expect(draft.staff).toEqual(["Captain- Pat Example (captain)", "Server 1- Sam Sample (server)"]);
    expect(draft.setup).toEqual(["Centerpieces - 8 tables, 1 per"]);
  });

  it("reads both schedule forms: the timed list and the TIME/EVENT/DETAILS table (AC1)", async () => {
    const { schedule } = await sample();
    expect(schedule.map(({ time, cue }) => [time, cue])).toEqual([
      ["14:30", "Leave Warehouse"],
      ["15:00", "Set Up"],
      ["17:00", "Guests Arrive"],
      ["18:30", "Toasts"],
    ]);
    expect(schedule[3].notes).toBe("Until 7PM · quiet");
    expect(schedule[2].notes).toBe("Welcome drinks");
  });

  it("keeps further sections and unplaced text, and they reach the notes (AC3)", async () => {
    const draft = await sample();
    expect(draft.unrecognized).toEqual(["Post event: team unloads the truck"]);
    expect(draft.other).toEqual([{ heading: "Inventory- Warehouse", lines: ["Left | Arrived | Qty | Item | Unload", "| | 8 | Sample linens | floor"] }]);
    const notes = importedNotes(draft);
    expect(notes).toContain("Event summary\nEvent title: Sample Harbor Reunion\nClient: Testwood Family");
    expect(notes).toContain("Menu\nCocktail Hour (5pm-6pm)");
    expect(notes).toContain("Drinks\nSample spritz - prebatched");
    expect(notes).toContain("Staff\nCaptain- Pat Example (captain)");
    expect(notes).toContain("Inventory- Warehouse");
    expect(notes).toContain("Not recognized\nPost event: team unloads the truck");
  });

  it("reads the new event from the summary (Q4)", async () => {
    expect(eventFromSummary(await sample())).toMatchObject({ title: "Sample Harbor Reunion", date: "2027-05-08", guestCount: 64, address: "12 Example Lane, Sampletown" });
  });

  it("accepts Word files and PDFs only, and says so for anything else (AC6)", async () => {
    expect(beoImportKind({ name: "beo.docx", type: "" })).toBe("docx");
    expect(beoImportKind({ name: "BEO.PDF", type: "" })).toBe("pdf");
    expect(beoImportKind({ name: "beo.txt", type: "text/plain" })).toBeNull();
    await expect(readBeoFile(new File(["hello"], "beo.txt", { type: "text/plain" }))).rejects.toThrow("Choose a Word (.docx) or PDF file.");
    await expect(readBeoFile(new File(["not a zip"], "beo.docx"))).rejects.toThrow("This Word file couldn't be read.");
  });

  it("needs exactly one of an event or a new event", () => {
    const base = { fileName: "beo.docx" };
    expect(beoImportInputSchema.safeParse(base).success).toBe(false);
    expect(beoImportInputSchema.safeParse({ ...base, eventId: "e0000000-0000-4000-8000-000000000338" }).success).toBe(true);
    expect(beoImportInputSchema.safeParse({ ...base, eventId: "e0000000-0000-4000-8000-000000000338",
      newEvent: { title: "X", date: "2027-05-08", startTime: "17:00" } }).success).toBe(false);
  });
});
