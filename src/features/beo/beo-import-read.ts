import { beoImportKind, type BeoImportBlock } from "../../../shared/beo-import";
import { parseProposalDocx } from "../sales/proposal-docx";

// Reads a BEO file in the browser into blocks for extractBeo (FLOW-338): a Word
// file as proposal intake reads it (paragraphs and table rows), a PDF line by
// line from its text (Q3: text PDFs only; a scan has no text to read).
export async function readBeoFile(file: File): Promise<BeoImportBlock[]> {
  const kind = beoImportKind(file);
  if (!kind) throw new Error("Choose a Word (.docx) or PDF file.");
  try {
    const blocks = kind === "docx" ? await parseProposalDocx(file) : await pdfLines(file);
    if (!blocks.length) throw new Error("empty");
    return blocks;
  } catch {
    throw new Error(kind === "pdf"
      ? "This PDF couldn't be read. Only PDFs with text (not scans) can be imported."
      : "This Word file couldn't be read. Check that it's a .docx file and try again.");
  }
}

async function pdfLines(file: File): Promise<BeoImportBlock[]> {
  const pdfjs = await import("pdfjs-dist");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    const { default: workerUrl } = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  }
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const blocks: BeoImportBlock[] = [];
  try {
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      // Text runs on the same baseline make one line.
      let line = "";
      let y: number | null = null;
      const flush = () => {
        if (line.trim()) blocks.push({ id: `block-${blocks.length}`, kind: "paragraph", text: line.trim() });
        line = "";
      };
      for (const item of content.items) {
        if (!("str" in item)) continue;
        const top = Math.round(item.transform[5]);
        if (y !== null && Math.abs(top - y) > 2) flush();
        y = top;
        line += (line && !line.endsWith(" ") && !item.str.startsWith(" ") ? " " : "") + item.str;
        if (item.hasEOL) flush();
      }
      flush();
    }
  } finally {
    await pdf.destroy();
  }
  return blocks;
}
