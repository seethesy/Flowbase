// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { parseProposalDocx } from "../src/features/proposal-docx";
import { suggestCatalog, unmatchedLines, type ProposalMapping } from "../shared/proposal-mapping";

const doc = (body: string) => {
  const bytes = new Uint8Array(zipSync({
  "word/document.xml": strToU8(`<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`),
  }));
  return { arrayBuffer: async () => bytes.buffer } as Blob;
};

describe("proposal review", () => {
  it("keeps paragraphs, headings and table rows in document order with source ids", async () => {
    const blocks = await parseProposalDocx(doc(`
      <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Menu</w:t></w:r></w:p>
      <w:p><w:r><w:t>Tuscan </w:t></w:r><w:r><w:t>Chicken</w:t></w:r></w:p>
      <w:tbl><w:tr><w:tc><w:p><w:r><w:t>Rental</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>12 chairs</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
    `));
    expect(blocks).toEqual([
      { id: "block-0", kind: "heading", text: "Menu" },
      { id: "block-1", kind: "paragraph", text: "Tuscan Chicken" },
      { id: "block-2", kind: "table", text: "Rental | 12 chairs", rows: [["Rental", "12 chairs"]] },
    ]);
  });

  it("suggests exact recipe matches first", () => {
    expect(suggestCatalog("Tuscan Chicken", [
      { id: "a", name: "Chicken Salad" }, { id: "b", name: "Tuscan Chicken" },
    ]).map((item) => item.id)).toEqual(["b", "a"]);
  });

  it("names unmatched rentals and accepts not tracked lines", () => {
    const mapping: ProposalMapping = {
      versionId: "00000000-0000-4000-8000-000000000001", fields: {}, staffing: [], timeline: [], charges: [], paymentSchedule: [], unextractedBlockIds: [],
      lines: [
        { id: "1", kind: "rental", section: "", name: "Gold chairs", notes: "", quantity: 12, sourceBlockId: "block-2", catalogId: null, notTracked: false },
        { id: "2", kind: "menu", section: "Mains", name: "Tuscan Chicken", notes: "", quantity: 50, sourceBlockId: "block-1", catalogId: null, notTracked: true },
      ],
    };
    expect(unmatchedLines(mapping)).toEqual(["Gold chairs"]);
  });
});
