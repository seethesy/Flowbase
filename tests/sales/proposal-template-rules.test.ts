// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseProposalDocx } from "../../src/features/sales/proposal-docx";
import { carryPreviousProposalReview, extractProposalTemplate } from "../../src/features/sales/proposal-template-rules";

// Synthetic proposals built by scripts/generate-proposal-fixtures.mjs; real exports stay in Flowbase-Data (ADR-27).
const versionId = "00000000-0000-4000-8000-000000000001";
async function sample(name: string) {
  const bytes = readFileSync(resolve("tests", "fixtures", "proposals", name));
  const blocks = await parseProposalDocx({ arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) } as Blob);
  return { blocks, mapping: extractProposalTemplate(blocks, versionId) };
}

describe("finalized proposal template rules", () => {
  it.each(["synthetic-proposal-event.docx", "synthetic-proposal-dinner.docx"])("keeps source pointers and unknown rows from %s", async (file) => {
    const { blocks, mapping } = await sample(file);
    const ids = new Set(blocks.map((block) => block.id));
    const pointed = [
      ...Object.values(mapping.fields), ...mapping.lines, ...mapping.staffing,
      ...mapping.timeline, ...mapping.charges, ...mapping.paymentSchedule,
    ].map((value) => value.sourceBlockId);
    expect(pointed.length).toBeGreaterThan(10);
    expect(pointed.every((id) => id && ids.has(id))).toBe(true);
    expect(mapping.unextractedBlockIds.length).toBeGreaterThan(0);
    expect(mapping.unextractedBlockIds.some((id) => blocks.find((block) => block.id === id)?.text.includes("Rental Item"))).toBe(true);
  });

  it("extracts the event proposal's details, menu, rentals, decor, staff, fees and payments", async () => {
    const { mapping } = await sample("synthetic-proposal-event.docx");
    expect(mapping.fields.eventDate.value).toBe("09/12/2026");
    expect(mapping.fields.startTime.value).toBe("5pm");
    expect(mapping.fields.endTime.value).toBe("11pm");
    expect(mapping.fields.address.value).toBe("400 Sample Avenue, Testville");
    expect(mapping.fields.guestCount.value).toBe("80");
    expect(mapping.fields.eventType.value).toBe("Wedding");
    expect(mapping.fields.serviceType.value).toBe("Partial Coordination");
    expect(mapping.fields.foodServiceStyle.value).toBe("Food cart");
    expect(mapping.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "menu", name: "Grazing Board", section: "COCKTAIL HOUR", notes: expect.stringContaining("No: walnuts") }),
      expect.objectContaining({ kind: "rental", name: "Folding Chairs", quantity: 80 }),
      expect.objectContaining({ kind: "decor", name: "Bridal Bouquet", quantity: 1 }),
      expect.objectContaining({ kind: "decor", name: "Flower Wall", quantity: 1, section: "DECOR LARGE DECOR" }),
      expect.objectContaining({ kind: "rental", name: "Cake Table", quantity: 1 }),
      expect.objectContaining({ kind: "service", name: "Partial Coordination" }),
      expect.objectContaining({ kind: "service", name: "Magician", quantity: 1 }),
    ]));
    expect(mapping.staffing).toContainEqual(expect.objectContaining({ position: "Prep", count: 4 }));
    expect(mapping.timeline.some((entry) => entry.value.includes("Setup"))).toBe(true);
    expect(mapping.charges.some((entry) => entry.value.includes("FINAL TOTAL | $18,574.00"))).toBe(true);
    expect(mapping.paymentSchedule.some((entry) => entry.value.includes("Deposit paid"))).toBe(true);
  });

  it("extracts the dinner proposal's duration, buffet, menu notes and stated total", async () => {
    const { mapping } = await sample("synthetic-proposal-dinner.docx");
    expect(mapping.fields.eventDate.value).toBe("November 7, 2026");
    expect(mapping.fields.startTime.value).toBe("5pm");
    expect(mapping.fields.endTime.value).toBe("8pm");
    expect(mapping.fields.guestCount.value).toBe("40");
    expect(mapping.fields.eventType.value).toBe("Birthday");
    expect(mapping.fields.serviceType.value).toBe("Full Service");
    expect(mapping.fields.foodServiceStyle.value).toBe("Buffet");
    expect(mapping.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "menu", name: "Garden Salad", notes: expect.stringContaining("dressing on side") }),
      expect.objectContaining({ kind: "rental", name: "Chafing Dish Sets", quantity: 3 }),
      expect.objectContaining({ kind: "service", name: "Full Service" }),
    ]));
    expect(mapping.staffing).toContainEqual(expect.objectContaining({ position: "Servers", count: 3 }));
    expect(mapping.charges.some((entry) => entry.value.includes("ESTIMATED TOTAL via ACH | $2,347.40"))).toBe(true);
    expect(mapping.paymentSchedule.some((entry) => entry.value.includes("$2,347.40 via ACH"))).toBe(true);
  });

  it("keeps catalog decisions while refreshing source pointers for a new version", async () => {
    const { mapping } = await sample("synthetic-proposal-dinner.docx");
    const recipe = mapping.lines.find((line) => line.name === "Garden Salad")!;
    const previous = {
      ...mapping,
      versionId: "00000000-0000-4000-8000-000000000002",
      totalCents: 234740,
      lines: [{ ...recipe, catalogId: "00000000-0000-4000-8000-000000000003", sourceBlockId: "obsolete" }],
    };
    const next = carryPreviousProposalReview(mapping, previous);
    expect(next.lines.find((line) => line.name === "Garden Salad")).toMatchObject({
      catalogId: previous.lines[0].catalogId, sourceBlockId: recipe.sourceBlockId,
    });
    expect(next.versionId).toBe(versionId);
    expect(next.totalCents).toBeNull();
  });
});
