// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseProposalDocx } from "../src/features/proposal-docx";
import { carryPreviousProposalReview, extractProposalTemplate } from "../src/features/proposal-template-rules";

const versionId = "00000000-0000-4000-8000-000000000001";
async function sample(name: string) {
  const bytes = readFileSync(resolve("docs", "source-data", name));
  const blocks = await parseProposalDocx({ arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) } as Blob);
  return { blocks, mapping: extractProposalTemplate(blocks, versionId) };
}

describe("finalized proposal template rules", () => {
  it.each(["sample-proposal-event.docx", "sample-proposal-dinner.docx"])("keeps source pointers and unknown rows from %s", async (file) => {
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
    const { mapping } = await sample("sample-proposal-event.docx");
    expect(mapping.fields.eventDate.value).toBe("10/10/2026");
    expect(mapping.fields.startTime.value).toBe("4pm");
    expect(mapping.fields.endTime.value).toBe("10pm");
    expect(mapping.fields.address.value).toBe("[street address]");
    expect(mapping.fields.guestCount.value).toBe("75");
    expect(mapping.fields.eventType.value).toBe("Wedding");
    expect(mapping.fields.serviceType.value).toBe("Partial Coordination");
    expect(mapping.fields.foodServiceStyle.value).toBe("Food cart");
    expect(mapping.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "menu", name: "Charcuterie/Grazing Table", section: "COCKTAIL HOUR" }),
      expect.objectContaining({ kind: "rental", name: "Foldable Chairs", quantity: 70 }),
      expect.objectContaining({ kind: "decor", name: "Bridal Bouquet", quantity: 1 }),
      expect.objectContaining({ kind: "decor", name: "Green Wall", quantity: 1 }),
      expect.objectContaining({ kind: "service", name: "Magician", quantity: 1 }),
    ]));
    expect(mapping.staffing).toContainEqual(expect.objectContaining({ position: "Prep", count: 3 }));
    expect(mapping.timeline.some((entry) => entry.value.includes("Setup"))).toBe(true);
    expect(mapping.charges.some((entry) => entry.value.includes("$39,624.76"))).toBe(true);
    expect(mapping.paymentSchedule.some((entry) => entry.value.includes("Deposit paid"))).toBe(true);
  });

  it("extracts the dinner proposal's duration, buffet, menu notes and stated total", async () => {
    const { mapping } = await sample("sample-proposal-dinner.docx");
    expect(mapping.fields.eventDate.value).toBe("October 17, 2026");
    expect(mapping.fields.startTime.value).toBe("4pm");
    expect(mapping.fields.endTime.value).toBe("7pm");
    expect(mapping.fields.guestCount.value).toBe("55");
    expect(mapping.fields.eventType.value).toBe("Birthday");
    expect(mapping.fields.serviceType.value).toBe("Full Service");
    expect(mapping.fields.foodServiceStyle.value).toBe("Buffet");
    expect(mapping.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "menu", name: "Caesar Salad", notes: expect.stringContaining("croutons on side") }),
      expect.objectContaining({ kind: "rental", name: "Chafing Dish Sets", quantity: 4 }),
      expect.objectContaining({ kind: "service", name: "Full Service" }),
    ]));
    expect(mapping.staffing).toContainEqual(expect.objectContaining({ position: "Servers", count: 2 }));
    expect(mapping.charges.some((entry) => entry.value.includes("ESTIMATED TOTAL via ACH | $3,240.10"))).toBe(true);
    expect(mapping.paymentSchedule.some((entry) => entry.value.includes("$3,240.10 via ACH"))).toBe(true);
  });

  it("keeps catalog decisions while refreshing source pointers for a new version", async () => {
    const { mapping } = await sample("sample-proposal-dinner.docx");
    const recipe = mapping.lines.find((line) => line.name === "Caesar Salad")!;
    const previous = {
      ...mapping,
      versionId: "00000000-0000-4000-8000-000000000002",
      lines: [{ ...recipe, catalogId: "00000000-0000-4000-8000-000000000003", sourceBlockId: "obsolete" }],
    };
    const next = carryPreviousProposalReview(mapping, previous);
    expect(next.lines.find((line) => line.name === "Caesar Salad")).toMatchObject({
      catalogId: previous.lines[0].catalogId, sourceBlockId: recipe.sourceBlockId,
    });
    expect(next.versionId).toBe(versionId);
  });
});
